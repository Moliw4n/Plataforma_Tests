-- =====================================================================
-- Plataforma de tests · IES Santa Bárbara
-- 01_esquema.sql · tablas, seguridad (RLS) y funciones   (versión 2)
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin romper nada (no borra datos).
--
-- Cómo entra un alumno: escribe SU CÓDIGO personal (p. ej. K7M-4QX).
-- En la base de datos solo hay un número interno (TDA2-07) y el código
-- cifrado. Los nombres reales están solo en el ordenador del profesor.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Si se ejecutó la versión 1 (alias + PIN), se retira. Aún no tenía datos.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'alumnos' and column_name = 'pin_hash') then
    drop table if exists public.intentos cascade;
    drop table if exists public.alumnos cascade;
    drop function if exists public.alias_del_grupo(text);
    drop function if exists public.entrar(text, text);
    drop function if exists public.guardar_intento(text, text, jsonb);
    drop function if exists public._pin_valido(text, text);
  end if;
end $$;

-- ---------- Tablas ----------------------------------------------------

create table if not exists public.grupos (
  id      text primary key,               -- 'TDA2'
  nombre  text not null                    -- 'TDA II'
);

-- Alumnos: número interno + código cifrado. Ningún nombre ni correo.
create table if not exists public.alumnos (
  id           text primary key,           -- 'TDA2-07'
  grupo        text not null references public.grupos(id),
  codigo_hash  text not null unique,       -- sha256 del código; el código en claro no se guarda
  activo       boolean not null default true
);

-- Cada vez que un alumno termina un test
create table if not exists public.intentos (
  id          bigint generated always as identity primary key,
  alumno      text not null references public.alumnos(id) on update cascade,
  test_id     text not null,
  version     int  not null default 1,
  empezado    timestamptz,
  terminado   timestamptz not null default now(),
  segundos    int,
  total       int  not null,
  aciertos    int  not null,
  nota        numeric(4,2) not null,
  respuestas  jsonb not null,              -- [{id, elegida, ok, ms}, …]
  creado      timestamptz not null default now()
);
create index if not exists intentos_alumno_idx on public.intentos(alumno);
create index if not exists intentos_test_idx   on public.intentos(test_id);

-- Códigos mal escritos (para frenar a quien intente adivinar códigos)
create table if not exists public.accesos_fallidos (
  momento timestamptz not null default now()
);
create index if not exists accesos_fallidos_idx on public.accesos_fallidos(momento);

-- Profesores con acceso al panel (correo de su cuenta de Supabase Auth)
create table if not exists public.profesores (
  email text primary key
);

-- ---------- Seguridad: todo cerrado por defecto -----------------------

alter table public.grupos           enable row level security;
alter table public.alumnos          enable row level security;
alter table public.intentos         enable row level security;
alter table public.accesos_fallidos enable row level security;
alter table public.profesores       enable row level security;

revoke all on public.grupos, public.alumnos, public.intentos, public.accesos_fallidos, public.profesores from anon, authenticated;

create or replace function public.es_profesor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profesores p
                 where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- El profesor (con sesión iniciada) puede leer grupos, alumnos (sin código) e intentos, y borrar intentos
grant select on public.grupos to authenticated;
grant select (id, grupo, activo) on public.alumnos to authenticated;
grant select, delete on public.intentos to authenticated;

drop policy if exists profe_lee_grupos     on public.grupos;
drop policy if exists profe_lee_alumnos    on public.alumnos;
drop policy if exists profe_lee_intentos   on public.intentos;
drop policy if exists profe_borra_intentos on public.intentos;
create policy profe_lee_grupos     on public.grupos   for select to authenticated using (public.es_profesor());
create policy profe_lee_alumnos    on public.alumnos  for select to authenticated using (public.es_profesor());
create policy profe_lee_intentos   on public.intentos for select to authenticated using (public.es_profesor());
create policy profe_borra_intentos on public.intentos for delete to authenticated using (public.es_profesor());

-- ---------- Funciones que usa la página del alumno --------------------
-- Son la ÚNICA puerta desde la web pública.

-- Normaliza y cifra un código: 'k7m-4qx ' → sha256('plataforma-tests:K7M4QX')
create or replace function public._hash_codigo(p_codigo text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest('plataforma-tests:' || upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
$$;

-- Devuelve el alumno de ese código, o null. Si hay demasiados fallos
-- en el último minuto (alguien probando códigos), no deja entrar a nadie un rato.
create or replace function public._quien(p_codigo text) returns public.alumnos
language plpgsql security definer set search_path = public as $$
declare a public.alumnos;
begin
  if (select count(*) from public.accesos_fallidos where momento > now() - interval '1 minute') >= 40 then
    raise exception 'demasiados_intentos';
  end if;
  select * into a from public.alumnos where codigo_hash = public._hash_codigo(p_codigo) and activo;
  if a.id is null then
    insert into public.accesos_fallidos default values;
    delete from public.accesos_fallidos where momento < now() - interval '1 day';
  end if;
  return a;
end $$;

-- Entrar: devuelve {ok:true, alumno:'TDA2-07', grupo:'TDA2'} o {ok:false, motivo}
create or replace function public.entrar(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos;
begin
  a := public._quien(p_codigo);
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  return jsonb_build_object('ok', true, 'alumno', a.id, 'grupo', a.grupo);
exception when others then
  if sqlerrm = 'demasiados_intentos' then return jsonb_build_object('ok', false, 'motivo', 'espera'); end if;
  raise;
end $$;

-- Guarda un intento terminado (solo con un código válido)
create or replace function public.guardar_intento(p_codigo text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos;
begin
  begin
    a := public._quien(p_codigo);
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'espera');
  end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  if jsonb_typeof(p_datos -> 'respuestas') is distinct from 'array'
     or jsonb_array_length(p_datos -> 'respuestas') > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  insert into public.intentos(alumno, test_id, version, empezado, terminado, segundos, total, aciertos, nota, respuestas)
  values (a.id,
          left(p_datos ->> 'test', 80),
          coalesce((p_datos ->> 'version')::int, 1),
          (p_datos ->> 'empezado')::timestamptz,
          coalesce((p_datos ->> 'terminado')::timestamptz, now()),
          (p_datos ->> 'segundos')::int,
          (p_datos ->> 'total')::int,
          (p_datos ->> 'aciertos')::int,
          (p_datos ->> 'nota')::numeric,
          p_datos -> 'respuestas');
  return jsonb_build_object('ok', true);
end $$;

-- Permisos: la web pública solo puede llamar a entrar() y guardar_intento()
revoke all on function public._hash_codigo(text)              from public, anon, authenticated;
revoke all on function public._quien(text)                    from public, anon, authenticated;
revoke all on function public.entrar(text)                    from public;
revoke all on function public.guardar_intento(text, jsonb)    from public;
revoke all on function public.es_profesor()                   from public, anon;
grant execute on function public.entrar(text)                 to anon, authenticated;
grant execute on function public.guardar_intento(text, jsonb) to anon, authenticated;
grant execute on function public.es_profesor()                to authenticated;
