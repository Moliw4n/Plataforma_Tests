-- =====================================================================
-- Kiron · PAQUETE PARA EL PROYECTO DE PRUEBAS  (archivo GENERADO: no se edita a mano)
-- Lo genera scripts/empaquetar-sql.mjs juntando, por este orden:
--   01_esquema.sql
--   03_profesor_alumnos.sql
--   04_latido.sql
--   05_datos_prueba.sql
--   06_contenido.sql
--   07_examen.sql
--   08_panel_examen.sql
--   09_directo.sql
-- Cómo usarlo: Supabase del proyecto de PRUEBAS → SQL Editor → New query → pega TODO este archivo → Run.
-- Se puede repetir sin romper nada. Al final sale UNA fila de comprobación (mira la última consulta).
--
-- SOLO PARA EL PROYECTO DE PRUEBAS. Crea alumnos inventados (PRUEBA-01…05). Si la base tiene alumnos reales,
-- la guarda de aquí abajo se niega a ejecutar NADA.
-- =====================================================================

-- GUARDA: lo primero. Si hay alumnos que no son de prueba, aborta antes de tocar nada.
do $guarda$
declare hay boolean := false;
begin
  if to_regclass('public.alumnos') is not null then
    execute 'select exists (select 1 from public.alumnos where id not like ''PRUEBA-%'')' into hay;
  end if;
  if hay then
    raise exception 'Esta base tiene alumnos reales: este paquete es SOLO para el proyecto de pruebas. No se ha cambiado nada.';
  end if;
end $guarda$;

-- ##################### 01_esquema.sql #####################
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

-- ##################### 03_profesor_alumnos.sql #####################
-- =====================================================================
-- Plataforma de tests · 03_profesor_alumnos.sql
-- Permite que el PROFESOR (sesión iniciada, correo en public.profesores)
-- dé de alta, cambie el código o dé de baja alumnos desde Kronos.
-- Ejecutar una vez en Supabase → SQL Editor. Se puede repetir sin problema.
--
-- Kronos NUNCA envía el código en claro: manda su hash,
--   sha256('plataforma-tests:' || CÓDIGO_EN_MAYÚSCULAS_SIN_GUION)  en hexadecimal,
-- que es exactamente lo que calcula public._hash_codigo().
-- =====================================================================

-- Alta o actualización de un grupo y sus alumnos, en una sola llamada.
-- p_alumnos = [{ "id": "TDA2-07", "hash": "<64 hex>", "activo": true }, …]
create or replace function public.profe_alta_alumnos(p_grupo text, p_nombre text, p_alumnos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; n int := 0;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if p_grupo !~ '^[A-Z0-9]{2,12}$' then raise exception 'grupo_no_valido'; end if;
  if jsonb_typeof(p_alumnos) is distinct from 'array' or jsonb_array_length(p_alumnos) > 60 then
    raise exception 'lista_no_valida';
  end if;
  -- El nombre se pone SOLO al crear el grupo: las sincronizaciones siguientes no lo pisan.
  insert into public.grupos(id, nombre) values (p_grupo, left(coalesce(nullif(p_nombre, ''), p_grupo), 60))
  on conflict (id) do nothing;
  for a in select * from jsonb_array_elements(p_alumnos) loop
    if (a ->> 'id') !~ ('^' || p_grupo || '-[0-9]{2,3}$') then raise exception 'id_no_valido: %', a ->> 'id'; end if;
    if (a ->> 'hash') !~ '^[0-9a-f]{64}$' then raise exception 'hash_no_valido: %', a ->> 'id'; end if;
    insert into public.alumnos(id, grupo, codigo_hash, activo)
    values (a ->> 'id', p_grupo, a ->> 'hash', coalesce((a ->> 'activo')::boolean, true))
    on conflict (id) do update set codigo_hash = excluded.codigo_hash, activo = excluded.activo, grupo = excluded.grupo;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'alumnos', n);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_repetido');   -- dos alumnos con el mismo código: Kronos genera otro
end $$;

-- Dar de baja (no borra sus intentos: dejan de poder entrar y salen como inactivos)
create or replace function public.profe_baja_alumno(p_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  update public.alumnos set activo = false where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.profe_alta_alumnos(text, text, jsonb) from public, anon;
revoke all on function public.profe_baja_alumno(text)               from public, anon;
grant execute on function public.profe_alta_alumnos(text, text, jsonb) to authenticated;
grant execute on function public.profe_baja_alumno(text)               to authenticated;

-- ##################### 04_latido.sql #####################
-- =====================================================================
-- Kiron · 04_latido.sql  (fase 0)
-- «Latido» anti-pausa: el plan gratuito de Supabase pausa un proyecto tras una semana sin
-- actividad. Una tarea de GitHub Actions llama a latido() cada 3 días y así nunca está quieto.
-- Ejecutar en Supabase → SQL Editor → New query → Run. Se puede repetir sin romper nada.
--
-- No toca ninguna tabla existente. Crea una tabla nueva (latidos) y una función nueva (latido).
-- =====================================================================

create table if not exists public.latidos (
  id      bigint generated always as identity primary key,
  momento timestamptz not null default now()
);
create index if not exists latidos_momento_idx on public.latidos(momento);

-- Cerrada por defecto, como todo lo demás: la web pública no lee ni escribe la tabla.
alter table public.latidos enable row level security;
revoke all on public.latidos from anon, authenticated;

-- latido(): escribe una fila como máximo cada hora (aunque alguien la llame mil veces no crece
-- la tabla) y borra las de más de 30 días. Devuelve {ok, escrito}.
create or replace function public.latido() returns jsonb
language plpgsql security definer set search_path = public as $$
declare escrito boolean := false;
begin
  if not exists (select 1 from public.latidos where momento > now() - interval '1 hour') then
    insert into public.latidos default values;
    delete from public.latidos where momento < now() - interval '30 days';
    escrito := true;
  end if;
  return jsonb_build_object('ok', true, 'escrito', escrito);
end $$;

revoke all on function public.latido() from public;
grant execute on function public.latido() to anon, authenticated;

-- ##################### 05_datos_prueba.sql #####################
-- =====================================================================
-- Kiron · 05_datos_prueba.sql  (fase 0)
-- SOLO PARA EL PROYECTO DE PRUEBAS. Crea un grupo y 5 alumnos INVENTADOS para ensayar.
-- Ejecutar después de 01_esquema.sql y 03_profesor_alumnos.sql. Se puede repetir.
--
-- Códigos de prueba (se escriben en la pantalla de acceso, con o sin guion):
--   PRUEBA-01 → AAA-222    PRUEBA-02 → BBB-333    PRUEBA-03 → CCC-444
--   PRUEBA-04 → DDD-555    PRUEBA-05 → EEE-666
-- Aquí no hay ningún dato personal: son números y códigos inventados.
--
-- SEGURO: si la base ya tiene alumnos que no son de prueba, este script se niega a ejecutarse.
-- Así no se puede lanzar por error en el proyecto real.
-- =====================================================================

do $$
begin
  if exists (select 1 from public.alumnos where id not like 'PRUEBA-%') then
    raise exception 'Esta base tiene alumnos reales. 05_datos_prueba.sql es solo para el proyecto de pruebas: no se ha cambiado nada.';
  end if;
end $$;

insert into public.grupos(id, nombre) values ('PRUEBA', 'Grupo de pruebas')
on conflict (id) do update set nombre = excluded.nombre;

insert into public.alumnos(id, grupo, codigo_hash, activo) values
  ('PRUEBA-01', 'PRUEBA', public._hash_codigo('AAA222'), true),
  ('PRUEBA-02', 'PRUEBA', public._hash_codigo('BBB333'), true),
  ('PRUEBA-03', 'PRUEBA', public._hash_codigo('CCC444'), true),
  ('PRUEBA-04', 'PRUEBA', public._hash_codigo('DDD555'), true),
  ('PRUEBA-05', 'PRUEBA', public._hash_codigo('EEE666'), true)
on conflict (id) do update set codigo_hash = excluded.codigo_hash, activo = excluded.activo, grupo = excluded.grupo;

-- Comprobación: debe salir 5
select count(*) as alumnos_de_prueba from public.alumnos where grupo = 'PRUEBA';

-- ##################### 06_contenido.sql #####################
-- =====================================================================
-- Kiron · 06_contenido.sql  (fase 1, paso 3)
-- Contenido y partidas en el servidor: bancos de preguntas (CON soluciones), juegos, asignaciones,
-- partidas, respuestas y eventos. Más las funciones del PROFESOR para subir bancos y montar exámenes.
-- Ejecutar en Supabase → SQL Editor → New query → Run. Se puede repetir sin romper nada.
-- Requiere haber ejecutado antes 01_esquema.sql y 03_profesor_alumnos.sql.
--
-- No modifica ninguna tabla ni función existente (intentos, guardar_intento… siguen igual).
-- SEGURIDAD: todas las tablas nuevas están cerradas por defecto (RLS). La web pública (anon) no puede
-- leer NI escribir nada. El profesor (sesión iniciada con su correo en public.profesores) puede LEER todo;
-- para escribir usa las funciones profe_*. Las funciones del alumno (empezar examen, responder…) llegan en 07.
-- =====================================================================

-- ---------- Bancos y preguntas ----------------------------------------

create table if not exists public.bancos (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  titulo      text not null check (length(btrim(titulo)) between 1 and 200),
  materia     text,
  unidad      text,
  version     int  not null default 1,          -- sube cada vez que se vuelve a subir el banco
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- Una fila por pregunta. `datos` es la pregunta COMPLETA (formato 2), con su solución:
-- el alumno nunca la lee; solo funciones del servidor, y sin la solución.
create table if not exists public.items (
  banco      text not null references public.bancos(id) on delete cascade on update cascade,
  id         text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  orden      int  not null,
  tipo       text not null check (length(tipo) between 1 and 30),
  tema       text,                              -- para repartir las preguntas «equilibradas»
  dificultad smallint check (dificultad between 1 and 3),
  criterio   text,
  datos      jsonb not null,
  primary key (banco, id)
);
create index if not exists items_banco_orden_idx on public.items(banco, orden);

-- ---------- Juegos y asignaciones -------------------------------------

-- Un juego = un modo + uno o varios bancos + unas reglas
create table if not exists public.juegos (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  modo        text not null check (length(modo) between 1 and 30),
  titulo      text not null check (length(btrim(titulo)) between 1 and 200),
  bancos      text[] not null check (cardinality(bancos) between 1 and 10),
  reglas      jsonb not null default '{}'::jsonb,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- Un juego puesto a un grupo, con fechas, intentos y si se enseñan soluciones / notas
create table if not exists public.asignaciones (
  id                 bigint generated always as identity primary key,
  juego              text not null references public.juegos(id) on delete cascade,
  grupo              text not null references public.grupos(id) on update cascade,
  desde              timestamptz,
  hasta              timestamptz,
  intentos           int  not null default 1 check (intentos between 1 and 10),
  mostrar_soluciones boolean not null default false,
  notas_publicadas   boolean not null default false,
  creado             timestamptz not null default now(),
  unique (juego, grupo),
  check (desde is null or hasta is null or hasta > desde)
);

-- ---------- Partidas, respuestas y eventos ----------------------------

create table if not exists public.partidas (
  id         uuid primary key default gen_random_uuid(),
  alumno     text not null references public.alumnos(id) on update cascade,
  asignacion bigint not null references public.asignaciones(id),   -- sin cascade: no se borra una asignación con partidas
  intento    int  not null check (intento >= 1),
  estado     text not null default 'en_curso' check (estado in ('en_curso', 'entregada', 'caducada')),
  empezada   timestamptz not null default now(),
  limite     timestamptz,                       -- hasta cuándo se puede contestar (lo fija el servidor)
  terminada  timestamptz,
  seleccion  jsonb,                             -- las preguntas elegidas y el orden de sus opciones
  total      int,
  aciertos   int,
  nota       numeric(4,2) check (nota between 0 and 10),
  unique (alumno, asignacion, intento)
);
create index if not exists partidas_asignacion_idx on public.partidas(asignacion);

create table if not exists public.respuestas (
  partida uuid not null references public.partidas(id) on delete cascade,
  item    text not null,
  dada    jsonb,                                -- lo que contestó el alumno
  ok      boolean not null,
  ms      int,
  momento timestamptz not null default now(),
  primary key (partida, item)
);

-- Salidas de pestaña, vueltas, cortes de red… (para revisar un examen)
create table if not exists public.eventos (
  id      bigint generated always as identity primary key,
  partida uuid not null references public.partidas(id) on delete cascade,
  tipo    text not null check (tipo in ('salida', 'vuelta', 'recarga', 'sin_red', 'otro')),
  momento timestamptz not null default now(),
  detalle jsonb
);
create index if not exists eventos_partida_idx on public.eventos(partida);

-- ---------- Seguridad: todo cerrado; el profesor solo LEE ---------------

do $$
declare t text;
begin
  foreach t in array array['bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists profe_lee_%s on public.%I', t, t);
    execute format('create policy profe_lee_%s on public.%I for select to authenticated using (public.es_profesor())', t, t);
  end loop;
end $$;

-- ---------- Validación de una pregunta (interna) ----------------------
-- Devuelve null si está bien, o el motivo. Es la misma regla que js/nucleo/formato.js (validarBanco);
-- hay una prueba que comprueba que las dos coinciden. Tipos que se juegan hoy:
-- opcion_multiple, verdadero_falso, numerica, respuesta_corta.

create or replace function public._validar_item(p jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare t text; e jsonb; n int; v numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'no es un objeto'; end if;
  if jsonb_typeof(p -> 'id') is distinct from 'string' or (p ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$' then
    return 'id no válido (letras, números, - y _, hasta 40)';
  end if;
  if jsonb_typeof(p -> 'enun') is distinct from 'string' or btrim(p ->> 'enun') = '' or length(p ->> 'enun') > 3000 then
    return 'falta el enunciado (enun)';
  end if;
  if jsonb_typeof(p -> 'sol') is distinct from 'string' or btrim(p ->> 'sol') = '' or length(p ->> 'sol') > 3000 then
    return 'falta «sol» (por qué)';
  end if;
  if jsonb_typeof(p -> 'trampa') is distinct from 'string' or btrim(p ->> 'trampa') = '' or length(p ->> 'trampa') > 3000 then
    return 'falta «trampa»';
  end if;
  if jsonb_typeof(p -> 'tipo') is distinct from 'string' then return 'falta el tipo'; end if;
  t := p ->> 'tipo';

  if t = 'opcion_multiple' then
    if jsonb_typeof(p -> 'ops') is distinct from 'array' then return 'ops debe ser una lista'; end if;
    n := jsonb_array_length(p -> 'ops');
    if n < 2 or n > 6 then return 'ops debe tener de 2 a 6 opciones'; end if;
    for e in select * from jsonb_array_elements(p -> 'ops') loop
      if jsonb_typeof(e) is distinct from 'string' or length(e #>> '{}') > 1000 then return 'cada opción debe ser un texto'; end if;
    end loop;
    if jsonb_typeof(p -> 'ok') is distinct from 'number' then return 'ok debe ser el número de la opción correcta'; end if;
    v := (p ->> 'ok')::numeric;
    if v <> trunc(v) or v < 0 or v >= n then return 'ok debe ser el número de la opción correcta (0 a ' || (n - 1) || ')'; end if;

  elsif t = 'verdadero_falso' then
    if jsonb_typeof(p -> 'ok') is distinct from 'boolean' then return 'ok debe ser true o false'; end if;

  elsif t = 'numerica' then
    if jsonb_typeof(p -> 'valor') is distinct from 'number' then return 'valor debe ser un número'; end if;
    if p ? 'tolerancia' then
      if jsonb_typeof(p -> 'tolerancia') is distinct from 'number' or (p ->> 'tolerancia')::numeric < 0 then
        return 'tolerancia debe ser un número mayor o igual que 0';
      end if;
    end if;
    if p ? 'unidad' and (jsonb_typeof(p -> 'unidad') is distinct from 'string' or btrim(p ->> 'unidad') = '') then
      return 'unidad debe ser un texto';
    end if;

  elsif t = 'respuesta_corta' then
    if jsonb_typeof(p -> 'aceptadas') is distinct from 'array' then return 'aceptadas debe ser una lista'; end if;
    n := jsonb_array_length(p -> 'aceptadas');
    if n < 1 or n > 20 then return 'aceptadas debe tener de 1 a 20 respuestas'; end if;
    for e in select * from jsonb_array_elements(p -> 'aceptadas') loop
      if jsonb_typeof(e) is distinct from 'string' or btrim(e #>> '{}') = '' or length(e #>> '{}') > 200 then
        return 'cada respuesta aceptada debe ser un texto no vacío';
      end if;
    end loop;

  else
    return 'tipo «' || t || '» desconocido o todavía no se puede jugar';
  end if;

  if p ? 'dificultad' and (jsonb_typeof(p -> 'dificultad') is distinct from 'number' or (p ->> 'dificultad') not in ('1', '2', '3')) then
    return 'dificultad debe ser 1, 2 o 3';
  end if;
  if p ? 'criterio' and (jsonb_typeof(p -> 'criterio') is distinct from 'string' or btrim(p ->> 'criterio') = '') then
    return 'criterio debe ser un texto, por ejemplo «2.1»';
  end if;
  if p ? 'tema' and (jsonb_typeof(p -> 'tema') is distinct from 'string' or btrim(p ->> 'tema') = '') then
    return 'tema debe ser un texto';
  end if;
  return null;
end $$;

-- ---------- Funciones del profesor ------------------------------------
-- Todas comprueban es_profesor() y se pueden repetir. Si algo no es válido, no cambian NADA (una transacción).

-- Sube (o reemplaza) un banco entero: { formato:2, id, titulo, materia?, unidad?, preguntas:[…] }
-- El archivo se elige en el panel desde el ordenador del profesor: las soluciones NO pasan por el repositorio.
create or replace function public.profe_subir_banco(p_banco jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; ord bigint; msg text; n int; ver int; bid text;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if jsonb_typeof(p_banco) is distinct from 'object' then raise exception 'banco_no_valido: no es un objeto'; end if;
  if length(p_banco::text) > 3000000 then raise exception 'banco_demasiado_grande'; end if;
  if (p_banco ->> 'formato') is distinct from '2' then raise exception 'banco_no_valido: falta «formato: 2»'; end if;
  bid := p_banco ->> 'id';
  if jsonb_typeof(p_banco -> 'id') is distinct from 'string' or bid !~ '^[a-z0-9][a-z0-9_-]{0,59}$' then
    raise exception 'banco_no_valido: id no válido (minúsculas, números, - y _)';
  end if;
  if jsonb_typeof(p_banco -> 'titulo') is distinct from 'string' or btrim(p_banco ->> 'titulo') = '' or length(p_banco ->> 'titulo') > 200 then
    raise exception 'banco_no_valido: falta el título';
  end if;
  if jsonb_typeof(p_banco -> 'preguntas') is distinct from 'array' or jsonb_array_length(p_banco -> 'preguntas') < 1 then
    raise exception 'banco_no_valido: no hay preguntas';
  end if;
  n := jsonb_array_length(p_banco -> 'preguntas');
  if n > 500 then raise exception 'banco_no_valido: demasiadas preguntas (máximo 500)'; end if;

  for x, ord in select * from jsonb_array_elements(p_banco -> 'preguntas') with ordinality loop
    msg := public._validar_item(x);
    if msg is not null then raise exception 'item_no_valido: pregunta % (%): %', ord, coalesce(x ->> 'id', '?'), msg; end if;
  end loop;
  if (select count(distinct y ->> 'id') from jsonb_array_elements(p_banco -> 'preguntas') y) <> n then
    raise exception 'banco_no_valido: hay ids de pregunta repetidos';
  end if;

  -- Si ya se han hecho exámenes con este banco, no se cambia por debajo (los resultados dejarían de tener sentido)
  if exists (select 1 from public.partidas pa
               join public.asignaciones a on a.id = pa.asignacion
               join public.juegos j on j.id = a.juego
              where bid = any (j.bancos)) then
    raise exception 'banco_en_uso';
  end if;

  insert into public.bancos(id, titulo, materia, unidad)
  values (bid, left(p_banco ->> 'titulo', 200), left(p_banco ->> 'materia', 100), left(p_banco ->> 'unidad', 100))
  on conflict (id) do update
    set titulo = excluded.titulo, materia = excluded.materia, unidad = excluded.unidad,
        version = public.bancos.version + 1, actualizado = now()
  returning version into ver;

  delete from public.items where banco = bid;
  insert into public.items(banco, id, orden, tipo, tema, dificultad, criterio, datos)
  select bid, y ->> 'id', (o - 1)::int, y ->> 'tipo', y ->> 'tema', (y ->> 'dificultad')::smallint, y ->> 'criterio', y
    from jsonb_array_elements(p_banco -> 'preguntas') with ordinality as t(y, o);

  return jsonb_build_object('ok', true, 'banco', bid, 'version', ver, 'items', n);
end $$;

-- Borra un banco (solo si ningún juego lo usa)
create or replace function public.profe_borrar_banco(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if exists (select 1 from public.juegos where p_id = any (bancos)) then raise exception 'banco_en_uso'; end if;
  delete from public.bancos where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

-- Crea o cambia un juego: { id, modo:'examen', titulo, bancos:['…'], reglas:{ preguntas?, tiempo_min?, penalizacion?, equilibrar? } }
--   preguntas 1-100 (20) · tiempo_min 1-300 (30) · penalizacion 0-1 (0: lo que resta cada fallo, en fracción de una pregunta)
--   equilibrar 'tema' | 'ninguno' ('tema')
create or replace function public.profe_crear_juego(p_juego jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare jid text; r jsonb; k text; b jsonb; npreg int; disp int;
        reglas jsonb := '{}'::jsonb; bancos_j text[];
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if jsonb_typeof(p_juego) is distinct from 'object' then raise exception 'juego_no_valido: no es un objeto'; end if;
  jid := p_juego ->> 'id';
  if jsonb_typeof(p_juego -> 'id') is distinct from 'string' or jid !~ '^[a-z0-9][a-z0-9_-]{0,59}$' then
    raise exception 'juego_no_valido: id no válido (minúsculas, números, - y _)';
  end if;
  if (p_juego ->> 'modo') is distinct from 'examen' then raise exception 'juego_no_valido: modo no válido (por ahora solo «examen»)'; end if;
  if jsonb_typeof(p_juego -> 'titulo') is distinct from 'string' or btrim(p_juego ->> 'titulo') = '' or length(p_juego ->> 'titulo') > 200 then
    raise exception 'juego_no_valido: falta el título';
  end if;
  if jsonb_typeof(p_juego -> 'bancos') is distinct from 'array' or jsonb_array_length(p_juego -> 'bancos') not between 1 and 10 then
    raise exception 'juego_no_valido: bancos debe ser una lista de 1 a 10 bancos';
  end if;
  for b in select * from jsonb_array_elements(p_juego -> 'bancos') loop
    if jsonb_typeof(b) is distinct from 'string' then raise exception 'juego_no_valido: bancos debe ser una lista de textos'; end if;
  end loop;
  select array_agg(distinct x) into bancos_j from jsonb_array_elements_text(p_juego -> 'bancos') x;
  if (select count(*) from public.bancos where id = any (bancos_j)) <> cardinality(bancos_j) then
    raise exception 'juego_no_valido: algún banco no existe';
  end if;

  r := coalesce(p_juego -> 'reglas', '{}'::jsonb);
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'reglas_no_validas: reglas debe ser un objeto'; end if;
  for k in select jsonb_object_keys(r) loop
    if k not in ('preguntas', 'tiempo_min', 'penalizacion', 'equilibrar') then raise exception 'reglas_no_validas: regla desconocida «%»', k; end if;
  end loop;
  if r ? 'preguntas' and (jsonb_typeof(r -> 'preguntas') is distinct from 'number' or (r ->> 'preguntas')::numeric <> trunc((r ->> 'preguntas')::numeric)
                          or (r ->> 'preguntas')::numeric not between 1 and 100) then
    raise exception 'reglas_no_validas: preguntas debe ser un entero de 1 a 100';
  end if;
  if r ? 'tiempo_min' and (jsonb_typeof(r -> 'tiempo_min') is distinct from 'number' or (r ->> 'tiempo_min')::numeric <> trunc((r ->> 'tiempo_min')::numeric)
                           or (r ->> 'tiempo_min')::numeric not between 1 and 300) then
    raise exception 'reglas_no_validas: tiempo_min debe ser un entero de 1 a 300';
  end if;
  if r ? 'penalizacion' and (jsonb_typeof(r -> 'penalizacion') is distinct from 'number' or (r ->> 'penalizacion')::numeric not between 0 and 1) then
    raise exception 'reglas_no_validas: penalizacion debe ser un número de 0 a 1';
  end if;
  if r ? 'equilibrar' and (r ->> 'equilibrar') not in ('tema', 'ninguno') then
    raise exception 'reglas_no_validas: equilibrar debe ser «tema» o «ninguno»';
  end if;
  reglas := jsonb_build_object(
    'preguntas',    coalesce((r ->> 'preguntas')::int, 20),
    'tiempo_min',   coalesce((r ->> 'tiempo_min')::int, 30),
    'penalizacion', coalesce((r ->> 'penalizacion')::numeric, 0),
    'equilibrar',   coalesce(r ->> 'equilibrar', 'tema'));

  npreg := (reglas ->> 'preguntas')::int;
  select count(*) into disp from public.items where banco = any (bancos_j);
  if disp < npreg then raise exception 'juego_no_valido: pide % preguntas y los bancos solo tienen %', npreg, disp; end if;

  if exists (select 1 from public.partidas pa join public.asignaciones a on a.id = pa.asignacion where a.juego = jid) then
    raise exception 'juego_en_uso';
  end if;

  insert into public.juegos(id, modo, titulo, bancos, reglas)
  values (jid, 'examen', left(p_juego ->> 'titulo', 200), bancos_j, reglas)
  on conflict (id) do update
    set modo = excluded.modo, titulo = excluded.titulo, bancos = excluded.bancos, reglas = excluded.reglas, actualizado = now();
  return jsonb_build_object('ok', true, 'juego', jid, 'reglas', reglas);
end $$;

-- Pone un juego a un grupo (o cambia fechas, intentos y si se enseñan soluciones). No toca las notas publicadas.
create or replace function public.profe_asignar(
  p_juego text, p_grupo text, p_desde timestamptz default null, p_hasta timestamptz default null,
  p_intentos int default 1, p_mostrar_soluciones boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare aid bigint;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if not exists (select 1 from public.juegos where id = p_juego) then raise exception 'asignacion_no_valida: el juego no existe'; end if;
  if not exists (select 1 from public.grupos where id = p_grupo) then raise exception 'asignacion_no_valida: el grupo no existe'; end if;
  if p_intentos is null or p_intentos not between 1 and 10 then raise exception 'asignacion_no_valida: intentos debe ser de 1 a 10'; end if;
  if p_desde is not null and p_hasta is not null and p_hasta <= p_desde then raise exception 'asignacion_no_valida: «hasta» debe ser posterior a «desde»'; end if;
  insert into public.asignaciones(juego, grupo, desde, hasta, intentos, mostrar_soluciones)
  values (p_juego, p_grupo, p_desde, p_hasta, p_intentos, coalesce(p_mostrar_soluciones, false))
  on conflict (juego, grupo) do update
    set desde = excluded.desde, hasta = excluded.hasta, intentos = excluded.intentos, mostrar_soluciones = excluded.mostrar_soluciones
  returning id into aid;
  return jsonb_build_object('ok', true, 'asignacion', aid);
end $$;

-- Publica (o vuelve a ocultar) las notas de una asignación: hasta entonces, el alumno no ve la suya
create or replace function public.profe_publicar_notas(p_asignacion bigint, p_publicar boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  update public.asignaciones set notas_publicadas = coalesce(p_publicar, true) where id = p_asignacion;
  return jsonb_build_object('ok', found, 'notas_publicadas', coalesce(p_publicar, true));
end $$;

-- Quita una asignación (solo si nadie ha empezado ya una partida)
create or replace function public.profe_borrar_asignacion(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if exists (select 1 from public.partidas where asignacion = p_id) then raise exception 'asignacion_con_partidas'; end if;
  delete from public.asignaciones where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

-- ---------- Permisos: solo el profesor con sesión llama a profe_* ------

revoke all on function public._validar_item(jsonb) from public, anon, authenticated;
revoke all on function public.profe_subir_banco(jsonb)                                     from public, anon;
revoke all on function public.profe_borrar_banco(text)                                     from public, anon;
revoke all on function public.profe_crear_juego(jsonb)                                     from public, anon;
revoke all on function public.profe_asignar(text, text, timestamptz, timestamptz, int, boolean) from public, anon;
revoke all on function public.profe_publicar_notas(bigint, boolean)                        from public, anon;
revoke all on function public.profe_borrar_asignacion(bigint)                              from public, anon;
grant execute on function public.profe_subir_banco(jsonb)                                     to authenticated;
grant execute on function public.profe_borrar_banco(text)                                     to authenticated;
grant execute on function public.profe_crear_juego(jsonb)                                     to authenticated;
grant execute on function public.profe_asignar(text, text, timestamptz, timestamptz, int, boolean) to authenticated;
grant execute on function public.profe_publicar_notas(bigint, boolean)                        to authenticated;
grant execute on function public.profe_borrar_asignacion(bigint)                              to authenticated;

-- Comprobación: debe salir 7 (las tablas nuevas) y 6 (las funciones profe_* nuevas)
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos')) as tablas_nuevas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('profe_subir_banco', 'profe_borrar_banco', 'profe_crear_juego', 'profe_asignar', 'profe_publicar_notas', 'profe_borrar_asignacion')) as funciones_profe;

-- ##################### 07_examen.sql #####################
-- =====================================================================
-- Kiron · 07_examen.sql  (fase 1, paso 4)
-- Las funciones del ALUMNO para el modo examen. Corrige el SERVIDOR: la solución nunca viaja al móvil.
-- Ejecutar en Supabase → SQL Editor → New query → Run. Se puede repetir sin romper nada.
-- Requiere haber ejecutado antes 01, 03 y 06. No modifica nada existente.
--
-- Cómo funciona (el alumno solo llama a estas funciones, siempre con su código):
--   mis_juegos(codigo)                      → lo que tiene asignado y su estado
--   empezar_partida(codigo, asignacion)     → elige las preguntas (equilibradas), las baraja y empieza el reloj.
--                                             Si ya había una en curso, la REANUDA (recargar o cambiar de móvil no pierde nada).
--   responder(codigo, partida, item, dada)  → guarda y corrige EN EL SERVIDOR. No dice si acertó.
--   evento(codigo, partida, tipo)           → salidas de pestaña, vueltas, cortes de red…
--   terminar_partida(codigo, partida)       → entrega y calcula la nota. La nota NO se ve todavía.
--   mi_resultado(codigo, partida)           → la nota solo aparece cuando el profesor la publica.
-- Reglas: un intento por defecto (lo fija la asignación), el tiempo lo manda el servidor,
-- lo contestado fuera de tiempo no cuenta, y las partidas abandonadas se cierran solas cuando caduca el tiempo.
-- =====================================================================

-- ---------- Corrección de textos y números (misma regla que js/nucleo/preguntas/normalizar.js) ----------
-- Hay una prueba que compara estas dos funciones con las de JavaScript letra por letra.

-- Sin acentos ni diéresis (la ñ cuenta como n), en minúsculas (con tablas propias, sin depender del locale de la base), sin puntuación ni comillas al principio y al final,
-- y con los espacios de dentro reducidos a uno.
create or replace function public._normalizar_texto(s text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
           regexp_replace(
             translate(translate(lower(translate(coalesce(s, ''), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǢǣǦǧǨǩǪǫǬǭǮǯǰǴǵǸǹǺǻǼǽǾǿȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳʹ;΅Ά·ΈΉΊΌΎΏΐΪΫάέήίΰϊϋόύώϓϔЀЁЃЇЌЍЎЙйѐёѓїќѝўѶѷӁӂӐӑӒӓӖӗӚӛӜӝӞӟӢӣӤӥӦӧӪӫӬӭӮӯӰӱӲӳӴӵӸӹḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼι῁ῂῃῄῆῇῈΈῊΉῌ῍῎῏ῐῑῒΐῖῗῘῙῚΊ῝῞῟ῠῡῢΰῤῥῦῧῨῩῪΎῬ῭΅`ῲῳῴῶῷῸΌῺΏῼ´', 'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaIiOoUuUuUuUuUuAaAaÆæGgKkOoOoƷʒjGgNnAaÆæØøAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyʹ;¨Α·ΕΗΙΟΥΩιΙΥαεηιυιυουωϒϒЕЕГІКИУИиеегікиуѴѵЖжАаАаЕеӘәЖжЗзИиИиОоӨөЭэУуУуУуЧчЫыAaBbBbBbCcDdDdDdDdDdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTtTtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwyſAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYyααααααααΑΑΑΑΑΑΑΑεεεεεεΕΕΕΕΕΕηηηηηηηηΗΗΗΗΗΗΗΗιιιιιιιιΙΙΙΙΙΙΙΙοοοοοοΟΟΟΟΟΟυυυυυυυυΥΥΥΥωωωωωωωωΩΩΩΩΩΩΩΩααεεηηιιοουυωωααααααααΑΑΑΑΑΑΑΑηηηηηηηηΗΗΗΗΗΗΗΗωωωωωωωωΩΩΩΩΩΩΩΩαααααααΑΑΑΑΑι¨ηηηηηΕΕΗΗΗ᾿᾿᾿ιιιιιιΙΙΙΙ῾῾῾υυυυρρυυΥΥΥΥΡ¨¨`ωωωωωΟΟΩΩΩ´')), 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉƊƋƎƏƐƑƓƔƖƗƘƜƝƟƠƢƤƦƧƩƬƮƯƱƲƳƵƷƸƼǄǅǇǈǊǋǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǲǴǶǷǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃɄɅɆɈɊɌɎͰͲͶͿΆΈΉΊΌΎΏΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫϏϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽϾϿЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈἉἊἋἌἍἎἏἘἙἚἛἜἝἨἩἪἫἬἭἮἯἸἹἺἻἼἽἾἿὈὉὊὋὌὍὙὛὝὟὨὩὪὫὬὭὮὯᾈᾉᾊᾋᾌᾍᾎᾏᾘᾙᾚᾛᾜᾝᾞᾟᾨᾩᾪᾫᾬᾭᾮᾯᾸᾹᾺΆᾼῈΈῊΉῌῘῙῚΊῨῩῪΎῬῸΌῺΏῼＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ', 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžɓƃƅɔƈɖɗƌǝəɛƒɠɣɩɨƙɯɲɵơƣƥʀƨʃƭʈưʊʋƴƶʒƹƽǆǆǉǉǌǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǳǵƕƿǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟƞȣȥȧȩȫȭȯȱȳⱥȼƚⱦɂƀʉʌɇɉɋɍɏͱͳͷϳάέήίόύώαβγδεζηθικλμνξοπρστυφχψωϊϋϗϙϛϝϟϡϣϥϧϩϫϭϯθϸϲϻͻͼͽѐёђѓєѕіїјљњћќѝўџабвгдежзийклмнопрстуфхцчшщъыьэюяѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӏӂӄӆӈӊӌӎӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕßạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὑὓὕὗὠὡὢὣὤὥὦὧᾀᾁᾂᾃᾄᾅᾆᾇᾐᾑᾒᾓᾔᾕᾖᾗᾠᾡᾢᾣᾤᾥᾦᾧᾰᾱὰάᾳὲέὴήῃῐῑὶίῠῡὺύῥὸόὼώῳａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ'), U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', '                   '),
             '\s+', ' ', 'g'),
           '^[\s.,;:!?¡¿"''«»“”()\[\]]+|[\s.,;:!?¡¿"''«»“”()\[\]]+$', '', 'g');
$$;

-- «12», «-3», «+2», «3,5», «3.5», «−4» → número; cualquier otra cosa → null
create or replace function public._parsear_numero(s text) returns numeric
language plpgsql immutable set search_path = public as $$
declare t text;
begin
  t := replace(regexp_replace(translate(coalesce(s, ''), U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', '                   '), '^\s+|\s+$', '', 'g'), chr(8722), '-');
  if t !~ '^[+-]?[0-9]+([.,][0-9]+)?$' then return null; end if;
  return replace(t, ',', '.')::numeric;
end $$;

-- ¿Es correcta esta respuesta? `datos` = la pregunta completa; `dada` = lo que contestó
-- (opción múltiple: el índice ORIGINAL de la opción; verdadero/falso: boolean; numérica y corta: el texto).
create or replace function public._corregir_item(datos jsonb, dada jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare t text := datos ->> 'tipo'; v numeric; tol numeric; d text;
begin
  if t = 'opcion_multiple' then
    return jsonb_typeof(dada) = 'number' and (dada #>> '{}')::numeric = (datos ->> 'ok')::numeric;
  elsif t = 'verdadero_falso' then
    return jsonb_typeof(dada) = 'boolean' and dada = datos -> 'ok';
  elsif t = 'numerica' then
    if jsonb_typeof(dada) is distinct from 'string' then return false; end if;
    v := public._parsear_numero(dada #>> '{}');
    if v is null then return false; end if;
    tol := coalesce((datos ->> 'tolerancia')::numeric, 0);
    return abs(v - (datos ->> 'valor')::numeric) <= tol + 0.000000001;
  elsif t = 'respuesta_corta' then
    if jsonb_typeof(dada) is distinct from 'string' then return false; end if;
    d := public._normalizar_texto(dada #>> '{}');
    if d = '' then return false; end if;
    return exists (select 1 from jsonb_array_elements_text(datos -> 'aceptadas') a where public._normalizar_texto(a) = d);
  end if;
  return false;
end $$;

-- ---------- Piezas internas ----------------------------------------------

-- Orden en que se enseñan las opciones de una pregunta de opción múltiple (índices originales).
-- Si la pregunta lleva fija_ultima, la última opción se queda al final.
create or replace function public._barajar_opciones(datos jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare n int := jsonb_array_length(datos -> 'ops'); lista int[];
begin
  if datos -> 'fija_ultima' = 'true'::jsonb and n > 1 then
    select array_agg(i order by random()) into lista from generate_series(0, n - 2) i;
    lista := lista || (n - 1);
  else
    select array_agg(i order by random()) into lista from generate_series(0, n - 1) i;
  end if;
  return to_jsonb(lista);
end $$;

-- La pregunta tal como la ve el alumno: SOLO estos campos (lista blanca). Nunca ok, sol, trampa, valor, tolerancia,
-- aceptadas, salida… Las opciones salen ya en su orden barajado: el alumno contesta por POSICIÓN.
create or replace function public._item_alumno(datos jsonb, ops_orden jsonb, clave text) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'clave', clave, 'tipo', datos -> 'tipo', 'enun', datos -> 'enun', 'code', datos -> 'code', 'act', datos -> 'act',
    'categoria', datos -> 'categoria', 'pista', datos -> 'pista', 'unidad', datos -> 'unidad',
    'ops', case when datos ->> 'tipo' = 'opcion_multiple' and ops_orden is not null
                then (select jsonb_agg(datos -> 'ops' -> (v::int) order by o) from jsonb_array_elements_text(ops_orden) with ordinality as t(v, o))
           end));
$$;

-- Cierra una partida y calcula la nota con lo contestado (lo no contestado cuenta como fallo, sin penalización):
--   nota = (aciertos − penalización × fallos) / total × 10, entre 0 y 10
create or replace function public._cerrar_partida(p_id uuid, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare pa public.partidas; pen numeric; tot int; ac int; fa int;
begin
  select * into pa from public.partidas where id = p_id for update;
  if pa.id is null or pa.estado <> 'en_curso' then return; end if;
  select coalesce((j.reglas ->> 'penalizacion')::numeric, 0) into pen
    from public.asignaciones a join public.juegos j on j.id = a.juego where a.id = pa.asignacion;
  tot := jsonb_array_length(pa.seleccion);
  select count(*) filter (where ok), count(*) filter (where not ok) into ac, fa from public.respuestas where partida = p_id;
  update public.partidas
     set estado = p_estado,
         terminada = case when p_estado = 'caducada' then limite else now() end,
         total = tot, aciertos = ac,
         nota = round(greatest(0, (ac - coalesce(pen, 0) * fa)::numeric / greatest(tot, 1) * 10), 2)
   where id = p_id;
end $$;

-- Cierra las partidas cuyo tiempo (más 3 s de cortesía) ya pasó. p_alumno null = las de todos.
create or replace function public._cerrar_caducadas(p_alumno text default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.partidas
            where estado = 'en_curso' and limite + interval '3 seconds' < now() and (p_alumno is null or alumno = p_alumno) loop
    perform public._cerrar_partida(r.id, 'caducada'); n := n + 1;
  end loop;
  return n;
end $$;

-- La partida en marcha, lista para enseñar al alumno (sin soluciones) + lo ya contestado (con su posición)
create or replace function public._salida_partida(p_partida uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true, 'partida', pa.id, 'intento', pa.intento, 'titulo', j.titulo,
    'ahora', now(), 'limite', pa.limite,
    'restante_s', greatest(0, floor(extract(epoch from pa.limite - now()))::int),
    'total', jsonb_array_length(pa.seleccion),
    'items', (select jsonb_agg(public._item_alumno(i.datos, s -> 'ops_orden', s ->> 'clave') order by o)
                from jsonb_array_elements(pa.seleccion) with ordinality as t(s, o)
                join public.items i on i.banco = s ->> 'banco' and i.id = s ->> 'id'),
    'respondidas', coalesce((
      select jsonb_object_agg(r.item,
               case when s -> 'ops_orden' is not null and jsonb_typeof(r.dada) = 'number'
                    then to_jsonb((select (x.o - 1)::int from jsonb_array_elements_text(s -> 'ops_orden') with ordinality as x(v, o)
                                    where x.v::int = (r.dada #>> '{}')::int))
                    else r.dada end)
        from public.respuestas r
        join lateral (select e as s from jsonb_array_elements(pa.seleccion) e where e ->> 'clave' = r.item limit 1) q on true
       where r.partida = pa.id), '{}'::jsonb))
  from public.partidas pa
  join public.asignaciones a on a.id = pa.asignacion
  join public.juegos j on j.id = a.juego
 where pa.id = p_partida;
$$;

-- ---------- Funciones del alumno -------------------------------------------

-- Lo que tiene asignado el grupo del alumno. La nota solo aparece si el profesor la ha publicado.
create or replace function public.mis_juegos(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  perform public._cerrar_caducadas(a.id);
  return jsonb_build_object('ok', true, 'ahora', now(), 'juegos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'asignacion', asg.id, 'juego', j.id, 'titulo', j.titulo, 'modo', j.modo,
      'preguntas', (j.reglas ->> 'preguntas')::int, 'tiempo_min', (j.reglas ->> 'tiempo_min')::int,
      'desde', asg.desde, 'hasta', asg.hasta, 'intentos', asg.intentos,
      'estado', case when asg.desde is not null and now() < asg.desde then 'pronto'
                     when asg.hasta is not null and now() > asg.hasta then 'cerrado' else 'abierto' end,
      'hechos', (select count(*) from public.partidas p where p.alumno = a.id and p.asignacion = asg.id and p.estado <> 'en_curso'),
      'en_curso', (select p.id from public.partidas p where p.alumno = a.id and p.asignacion = asg.id and p.estado = 'en_curso'),
      'notas_publicadas', asg.notas_publicadas,
      'partidas', coalesce((select jsonb_agg(case when asg.notas_publicadas and p.estado <> 'en_curso'
                                                  then jsonb_build_object('id', p.id, 'intento', p.intento, 'estado', p.estado, 'nota', p.nota)
                                                  else jsonb_build_object('id', p.id, 'intento', p.intento, 'estado', p.estado) end order by p.intento)
                              from public.partidas p where p.alumno = a.id and p.asignacion = asg.id), '[]'::jsonb))
      order by asg.id)
    from public.asignaciones asg join public.juegos j on j.id = asg.juego
    where asg.grupo = a.grupo and j.modo = 'examen'), '[]'::jsonb));
end $$;

-- Empieza un examen (o reanuda el que estaba en marcha). Devuelve las preguntas SIN solución.
create or replace function public.empezar_partida(p_codigo text, p_asignacion bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; asg public.asignaciones; j public.juegos; pa public.partidas;
        hechos int; npreg int; sel jsonb;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id || ':' || p_asignacion::text, 0));   -- dos llamadas a la vez no crean dos partidas
  perform public._cerrar_caducadas(a.id);

  select * into asg from public.asignaciones where id = p_asignacion and grupo = a.grupo;
  if asg.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  select * into j from public.juegos where id = asg.juego;
  if j.modo <> 'examen' then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;

  select * into pa from public.partidas where alumno = a.id and asignacion = asg.id and estado = 'en_curso';
  if pa.id is not null then return public._salida_partida(pa.id); end if;          -- reanudar

  if asg.desde is not null and now() < asg.desde then return jsonb_build_object('ok', false, 'motivo', 'aun_no', 'desde', asg.desde); end if;
  if asg.hasta is not null and now() > asg.hasta then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  select count(*) into hechos from public.partidas where alumno = a.id and asignacion = asg.id;
  if hechos >= asg.intentos then return jsonb_build_object('ok', false, 'motivo', 'sin_intentos'); end if;

  -- Elegir las preguntas: con 'tema', se reparten por temas (la primera de cada tema, luego la segunda…) y se barajan
  npreg := (j.reglas ->> 'preguntas')::int;
  with cand as (
    select i.banco, i.id, i.datos,
           row_number() over (partition by case when j.reglas ->> 'equilibrar' = 'tema' then coalesce(i.tema, '') else '' end order by random()) as rn
      from public.items i where i.banco = any (j.bancos)
  ), elegidas as (
    select * from cand order by rn, random() limit npreg
  )
  select jsonb_agg(jsonb_build_object('banco', banco, 'id', id, 'clave', banco || '/' || id,
                                      'ops_orden', case when datos ->> 'tipo' = 'opcion_multiple' then public._barajar_opciones(datos) end)
                   order by random())
    into sel from elegidas;
  if sel is null or jsonb_array_length(sel) = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_preguntas'); end if;

  insert into public.partidas(alumno, asignacion, intento, limite, seleccion)
  values (a.id, asg.id, hechos + 1, now() + make_interval(mins => (j.reglas ->> 'tiempo_min')::int), sel)
  returning * into pa;
  return public._salida_partida(pa.id);
end $$;

-- Guarda y corrige una respuesta. No dice si acertó. p_dada: opción múltiple = POSICIÓN (0..n-1) en lo que vio;
-- verdadero/falso = true|false; numérica y corta = el texto. Se puede cambiar hasta entregar.
create or replace function public.responder(p_codigo text, p_partida uuid, p_item text, p_dada jsonb, p_ms int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas; s jsonb; datos jsonb; orig jsonb; n int; pos int; ok boolean;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id for update;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado <> 'en_curso' then return jsonb_build_object('ok', false, 'motivo', pa.estado); end if;
  if now() > pa.limite + interval '3 seconds' then
    perform public._cerrar_partida(pa.id, 'caducada');
    return jsonb_build_object('ok', false, 'motivo', 'caducada');
  end if;

  select e into s from jsonb_array_elements(pa.seleccion) e where e ->> 'clave' = p_item;
  if s is null then return jsonb_build_object('ok', false, 'motivo', 'item'); end if;
  select i.datos into datos from public.items i where i.banco = s ->> 'banco' and i.id = s ->> 'id';

  if datos ->> 'tipo' = 'opcion_multiple' then
    n := jsonb_array_length(datos -> 'ops');
    if jsonb_typeof(p_dada) is distinct from 'number' or (p_dada #>> '{}')::numeric <> trunc((p_dada #>> '{}')::numeric)
       or (p_dada #>> '{}')::numeric < 0 or (p_dada #>> '{}')::numeric >= n then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
    pos := (p_dada #>> '{}')::int;
    orig := s -> 'ops_orden' -> pos;                                  -- de la posición que vio al índice original
  elsif datos ->> 'tipo' = 'verdadero_falso' then
    if jsonb_typeof(p_dada) is distinct from 'boolean' then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
    orig := p_dada;
  else
    if jsonb_typeof(p_dada) is distinct from 'string' or length(p_dada #>> '{}') > 200 then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
    orig := p_dada;
  end if;

  ok := public._corregir_item(datos, orig);
  insert into public.respuestas(partida, item, dada, ok, ms)
  values (pa.id, p_item, orig, ok, case when p_ms between 0 and 3600000 then p_ms end)
  on conflict (partida, item) do update set dada = excluded.dada, ok = excluded.ok, ms = excluded.ms, momento = now();
  return jsonb_build_object('ok', true, 'restante_s', greatest(0, floor(extract(epoch from pa.limite - now()))::int));
end $$;

-- Apunta un suceso del examen (salida de pestaña, vuelta, recarga, corte de red). Máximo 500 por partida.
create or replace function public.evento(p_codigo text, p_partida uuid, p_tipo text, p_detalle jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado <> 'en_curso' then return jsonb_build_object('ok', false, 'motivo', pa.estado); end if;
  if p_tipo is null or p_tipo not in ('salida', 'vuelta', 'recarga', 'sin_red', 'otro') then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
  if (select count(*) from public.eventos where partida = pa.id) >= 500 then return jsonb_build_object('ok', true, 'anotado', false); end if;
  insert into public.eventos(partida, tipo, detalle)
  values (pa.id, p_tipo, case when p_detalle is not null and length(p_detalle::text) <= 500 then p_detalle end);
  return jsonb_build_object('ok', true, 'anotado', true);
end $$;

-- Entrega el examen. Calcula la nota, pero NO la enseña: se verá cuando el profesor la publique.
create or replace function public.terminar_partida(p_codigo text, p_partida uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado = 'en_curso' then
    perform public._cerrar_partida(pa.id, case when now() >= pa.limite - interval '1 second' then 'caducada' else 'entregada' end);
    select * into pa from public.partidas where id = p_partida;
  end if;
  return jsonb_build_object('ok', true, 'estado', pa.estado,
    'publicada', (select asg.notas_publicadas from public.asignaciones asg where asg.id = pa.asignacion));
end $$;

-- El resultado. Mientras el profesor no publique las notas, solo se sabe el estado. Con las notas publicadas:
-- nota, aciertos y total; y, si la asignación lo permite, la revisión pregunta a pregunta con su explicación.
create or replace function public.mi_resultado(p_codigo text, p_partida uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas; asg public.asignaciones; res jsonb;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado = 'en_curso' and now() > pa.limite + interval '3 seconds' then
    perform public._cerrar_partida(pa.id, 'caducada');
    select * into pa from public.partidas where id = p_partida;
  end if;
  select * into asg from public.asignaciones where id = pa.asignacion;
  res := jsonb_build_object('ok', true, 'estado', pa.estado, 'publicada', asg.notas_publicadas, 'terminada', pa.terminada);
  if pa.estado = 'en_curso' then
    return res || jsonb_build_object('restante_s', greatest(0, floor(extract(epoch from pa.limite - now()))::int));
  end if;
  if asg.notas_publicadas then
    res := res || jsonb_build_object('nota', pa.nota, 'aciertos', pa.aciertos, 'total', pa.total);
    if asg.mostrar_soluciones then
      res := res || jsonb_build_object('revision', (
        select jsonb_agg(jsonb_build_object(
                 'clave', s ->> 'clave', 'enun', i.datos -> 'enun', 'ok', coalesce(r.ok, false), 'respondida', r.item is not null,
                 'sol', i.datos -> 'sol', 'trampa', i.datos -> 'trampa',
                 'correcta', case i.datos ->> 'tipo' when 'opcion_multiple' then i.datos -> 'ops' -> ((i.datos ->> 'ok')::int)
                                                     when 'verdadero_falso' then i.datos -> 'ok'
                                                     when 'numerica' then i.datos -> 'valor'
                                                     else i.datos -> 'aceptadas' -> 0 end) order by o)
          from jsonb_array_elements(pa.seleccion) with ordinality as t(s, o)
          join public.items i on i.banco = s ->> 'banco' and i.id = s ->> 'id'
          left join public.respuestas r on r.partida = pa.id and r.item = s ->> 'clave'));
    end if;
  end if;
  return res;
end $$;

-- Del PROFESOR: cierra las partidas cuyo tiempo ya pasó (las que un alumno dejó abandonadas). Devuelve cuántas.
create or replace function public.profe_cerrar_caducadas() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  return jsonb_build_object('ok', true, 'cerradas', public._cerrar_caducadas(null));
end $$;

-- ---------- Permisos -------------------------------------------------------
-- Piezas internas: nadie desde fuera. Funciones del alumno: la web pública (con el código). Del profesor: con sesión.

revoke all on function public._normalizar_texto(text)                from public, anon, authenticated;
revoke all on function public._parsear_numero(text)                  from public, anon, authenticated;
revoke all on function public._corregir_item(jsonb, jsonb)           from public, anon, authenticated;
revoke all on function public._barajar_opciones(jsonb)               from public, anon, authenticated;
revoke all on function public._item_alumno(jsonb, jsonb, text)       from public, anon, authenticated;
revoke all on function public._cerrar_partida(uuid, text)            from public, anon, authenticated;
revoke all on function public._cerrar_caducadas(text)                from public, anon, authenticated;
revoke all on function public._salida_partida(uuid)                  from public, anon, authenticated;

revoke all on function public.mis_juegos(text)                       from public;
revoke all on function public.empezar_partida(text, bigint)          from public;
revoke all on function public.responder(text, uuid, text, jsonb, int) from public;
revoke all on function public.evento(text, uuid, text, jsonb)        from public;
revoke all on function public.terminar_partida(text, uuid)           from public;
revoke all on function public.mi_resultado(text, uuid)               from public;
grant execute on function public.mis_juegos(text)                        to anon, authenticated;
grant execute on function public.empezar_partida(text, bigint)           to anon, authenticated;
grant execute on function public.responder(text, uuid, text, jsonb, int) to anon, authenticated;
grant execute on function public.evento(text, uuid, text, jsonb)         to anon, authenticated;
grant execute on function public.terminar_partida(text, uuid)            to anon, authenticated;
grant execute on function public.mi_resultado(text, uuid)                to anon, authenticated;

revoke all on function public.profe_cerrar_caducadas() from public, anon;
grant execute on function public.profe_cerrar_caducadas() to authenticated;

-- Comprobación: debe salir 'memoria ram' y 47.5 (la corrección de textos y números funciona)
select public._normalizar_texto('  Memoria  RAM. ') as texto, public._parsear_numero('47,5') as numero;

-- ##################### 08_panel_examen.sql #####################
-- =====================================================================
-- Kiron · 08_panel_examen.sql  (fase 1, paso 6)
-- Lo que necesita el PANEL DEL PROFESOR (y, más adelante, Kronos) para ver y gestionar los exámenes:
--   profe_resultados(asignacion)           → una fila por partida, en el RESULTADO NORMALIZADO del plan (5.3):
--                                            { partida, alumno, juego, nota 0-10, puntos, segundos, por_criterio, respuestas }
--                                            más el estado, las salidas de pestaña y lo contestado pregunta a pregunta.
--   profe_estadisticas_examen(asignacion)  → por pregunta: aciertos, fallos, en blanco, % de fallo y reparto de respuestas
--   profe_borrar_partida(id)               → anula una partida (y libera ese intento) si hubo un problema técnico
-- Ejecutar en Supabase → SQL Editor → New query → Run. Se puede repetir sin romper nada.
-- Requiere 01, 03, 06 y 07. No modifica nada existente. Solo el profesor con sesión puede llamarlas.
-- =====================================================================

-- Resultados de una asignación. Cierra antes las partidas cuyo tiempo ya pasó.
create or replace function public.profe_resultados(p_asignacion bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare asg record;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  perform public._cerrar_caducadas(null);
  select a.id, a.juego, j.titulo, a.grupo, a.desde, a.hasta, a.intentos, a.mostrar_soluciones, a.notas_publicadas
    into asg from public.asignaciones a join public.juegos j on j.id = a.juego where a.id = p_asignacion;
  if asg.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;

  return jsonb_build_object(
    'ok', true,
    'asignacion', jsonb_build_object('id', asg.id, 'juego', asg.juego, 'titulo', asg.titulo, 'grupo', asg.grupo, 'desde', asg.desde, 'hasta', asg.hasta,
                                     'intentos', asg.intentos, 'mostrar_soluciones', asg.mostrar_soluciones, 'notas_publicadas', asg.notas_publicadas),
    'partidas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'partida', p.id, 'alumno', p.alumno, 'juego', asg.juego, 'intento', p.intento, 'estado', p.estado,
        'empezada', p.empezada, 'terminada', p.terminada,
        'segundos', case when p.terminada is not null then round(extract(epoch from p.terminada - p.empezada))::int end,
        'total', p.total, 'aciertos', p.aciertos, 'nota', p.nota, 'puntos', 0,
        'por_criterio', (
          select coalesce(jsonb_object_agg(c.criterio, round(c.ok::numeric / c.n, 2)), '{}'::jsonb)
            from (select i.criterio, count(*) as n, count(*) filter (where r.ok) as ok
                    from jsonb_array_elements(p.seleccion) s
                    join public.items i on i.banco = s ->> 'banco' and i.id = s ->> 'id'
                    left join public.respuestas r on r.partida = p.id and r.item = s ->> 'clave'
                   where i.criterio is not null group by i.criterio) c),
        'eventos', jsonb_build_object(
          'salidas',  (select count(*) from public.eventos e where e.partida = p.id and e.tipo = 'salida'),
          'vueltas',  (select count(*) from public.eventos e where e.partida = p.id and e.tipo = 'vuelta'),
          'recargas', (select count(*) from public.eventos e where e.partida = p.id and e.tipo = 'recarga'),
          'sin_red',  (select count(*) from public.eventos e where e.partida = p.id and e.tipo = 'sin_red'),
          'segundos_fuera', coalesce((select sum((e.detalle ->> 'segundos')::numeric)::int from public.eventos e
                                       where e.partida = p.id and e.tipo = 'vuelta' and (e.detalle ->> 'segundos') ~ '^[0-9]+$'), 0)),
        'respuestas', coalesce((
          select jsonb_agg(jsonb_build_object('id', s ->> 'clave', 'respondida', r.item is not null, 'ok', coalesce(r.ok, false), 'dada', r.dada, 'ms', r.ms) order by o)
            from jsonb_array_elements(p.seleccion) with ordinality as t(s, o)
            left join public.respuestas r on r.partida = p.id and r.item = s ->> 'clave'), '[]'::jsonb)
      ) order by p.alumno, p.intento)
      from public.partidas p where p.asignacion = p_asignacion), '[]'::jsonb));
end $$;

-- Estadísticas por pregunta de las partidas ya cerradas. Una pregunta en blanco cuenta como no acertada.
-- reparto (solo opción múltiple): cuántas veces se eligió cada opción, en su orden original.
create or replace function public.profe_estadisticas_examen(p_asignacion bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  perform public._cerrar_caducadas(null);
  if not exists (select 1 from public.asignaciones where id = p_asignacion) then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  return jsonb_build_object(
    'ok', true,
    'partidas', (select count(*) from public.partidas where asignacion = p_asignacion and estado <> 'en_curso'),
    'preguntas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clave', q.clave, 'enun', q.datos -> 'enun', 'tipo', q.datos -> 'tipo', 'tema', q.datos -> 'tema', 'criterio', q.datos -> 'criterio',
        'n', q.n, 'respondidas', q.respondidas, 'aciertos', q.aciertos, 'fallos', q.respondidas - q.aciertos, 'blancos', q.n - q.respondidas,
        'pct_fallo', round((q.n - q.aciertos)::numeric / q.n * 100, 1),
        'ms_tipico', q.ms_tipico,
        'reparto', case when q.datos ->> 'tipo' = 'opcion_multiple' then (
            select jsonb_agg(jsonb_build_object('texto', op.t, 'veces', (select count(*) from public.respuestas r2
                                                                           join public.partidas p2 on p2.id = r2.partida
                                                                          where p2.asignacion = p_asignacion and p2.estado <> 'en_curso'
                                                                            and r2.item = q.clave and r2.dada = to_jsonb(op.i - 1)),
                                                'correcta', (op.i - 1) = (q.datos ->> 'ok')::int) order by op.i)
              from jsonb_array_elements_text(q.datos -> 'ops') with ordinality as op(t, i)) end
      ) order by (q.n - q.aciertos)::numeric / q.n desc, q.clave)
      from (select s ->> 'clave' as clave, i.datos, count(*) as n, count(r.item) as respondidas, count(*) filter (where r.ok) as aciertos,
                   (percentile_cont(0.5) within group (order by r.ms))::int as ms_tipico
              from public.partidas p
              cross join lateral jsonb_array_elements(p.seleccion) s
              join public.items i on i.banco = s ->> 'banco' and i.id = s ->> 'id'
              left join public.respuestas r on r.partida = p.id and r.item = s ->> 'clave'
             where p.asignacion = p_asignacion and p.estado <> 'en_curso'
             group by s ->> 'clave', i.datos) q), '[]'::jsonb));
end $$;

-- Anula una partida y TODO lo suyo (respuestas y eventos), por ejemplo si al alumno se le cayó el móvil y hay que dejarle repetir.
-- Después, esa persona puede empezar de nuevo (si la asignación lo permite). No se puede deshacer.
create or replace function public.profe_borrar_partida(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  delete from public.partidas where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.profe_resultados(bigint)           from public, anon;
revoke all on function public.profe_estadisticas_examen(bigint)  from public, anon;
revoke all on function public.profe_borrar_partida(uuid)         from public, anon;
grant execute on function public.profe_resultados(bigint)          to authenticated;
grant execute on function public.profe_estadisticas_examen(bigint) to authenticated;
grant execute on function public.profe_borrar_partida(uuid)        to authenticated;

-- Comprobación: debe salir 3
select count(*) as funciones_nuevas from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('profe_resultados', 'profe_estadisticas_examen', 'profe_borrar_partida');

-- ##################### 09_directo.sql #####################
-- =====================================================================
-- Kiron · 09_directo.sql  (fase 2)
-- El modo DIRECTO (tipo Kahoot): el profesor abre una SALA con un código de 6 cifras, los alumnos entran con su código de siempre y
-- contestan desde el móvil mientras él proyecta la pregunta. El servidor manda el tiempo, corrige y reparte los puntos.
-- Ejecutar en Supabase → SQL Editor → New query → Run. Se puede repetir sin romper nada.
-- Requiere haber ejecutado antes 01, 03, 06 y 07. No modifica nada existente.
--
-- Paso 1 (este bloque): tablas y funciones del PROFESOR.
--   profe_directo_crear(datos)           → abre una sala: elige las preguntas (opción múltiple y verdadero/falso) y da su código
--   profe_directo_estado(sesion)         → todo lo que necesita la pantalla del profesor/proyector (sin soluciones hasta cerrar la pregunta)
--   profe_directo_avanzar(sesion, desde) → espera→pregunta 1, pregunta→resultado (cierra ya), resultado→siguiente pregunta o final
--   profe_directo_terminar(sesion)       → cierra la sala
--   profe_directo_activas()              → las salas abiertas (para volver a ellas tras recargar)
--   profe_directo_borrar(sesion)         → borra una sala y todo lo suyo
-- Paso 2: funciones del ALUMNO (siempre con su código):
--   directo_unirse(codigo, sala)                       → entra en la sala (solo su grupo); el servidor le da un apodo («Zorro Azul»)
--   directo_estado(codigo, sesion)                     → lo que ve su móvil: espera, pregunta (sin solución), resultado propio o podio
--   directo_responder(codigo, sesion, pregunta, dada)  → contesta UNA vez; no dice si acertó (eso sale al cerrar); puntos por rapidez
-- Puntos: acertar da de 1000 (al instante) a 500 (justo al acabar el tiempo); fallar o no contestar, 0. El tiempo lo mide el SERVIDOR.
-- SEGURIDAD: las tablas nuevas están cerradas (RLS): la web pública no lee ni escribe nada. El profesor solo LEE; escribe con estas funciones.
-- =====================================================================

-- ---------- Tablas ----------------------------------------------------

create table if not exists public.directo_sesiones (
  id        uuid primary key default gen_random_uuid(),
  sala      text not null check (sala ~ '^[0-9]{6}$'),
  grupo     text not null references public.grupos(id) on update cascade,     -- solo los alumnos de este grupo pueden entrar
  titulo    text not null check (length(btrim(titulo)) between 1 and 200),
  bancos    text[] not null check (cardinality(bancos) between 1 and 10),
  preguntas jsonb not null,                                                    -- [{banco, id, clave, ops_orden}] en el orden en que saldrán (fijo para todos)
  tiempo_s  int  not null check (tiempo_s between 5 and 120),
  estado    text not null default 'espera' check (estado in ('espera', 'pregunta', 'resultado', 'terminada')),
  actual    int  not null default -1,                                          -- pregunta en curso (0 = la primera); -1 = ninguna todavía
  abierta   timestamptz,                                                       -- cuándo se abrió la pregunta en curso
  limite    timestamptz,                                                       -- hasta cuándo se puede contestar
  creada    timestamptz not null default now(),
  terminada timestamptz
);
-- El código de sala es único entre las salas NO terminadas (después se puede reutilizar)
create unique index if not exists directo_sesiones_sala_viva on public.directo_sesiones(sala) where estado <> 'terminada';

create table if not exists public.directo_participantes (
  sesion  uuid not null references public.directo_sesiones(id) on delete cascade,
  alumno  text not null references public.alumnos(id) on update cascade on delete cascade,
  apodo   text not null,                                                       -- generado por el servidor («Zorro Azul»): en pantalla solo se ve esto
  puntos  int  not null default 0,
  aciertos int not null default 0,
  entro   timestamptz not null default now(),
  visto   timestamptz not null default now(),
  primary key (sesion, alumno),
  unique (sesion, apodo)
);

create table if not exists public.directo_respuestas (
  sesion   uuid not null,
  alumno   text not null,
  pregunta int  not null check (pregunta >= 0),
  dada     jsonb,                                                              -- opción múltiple: índice de la opción; verdadero/falso: true|false
  ok       boolean not null,
  ms       int,                                                                -- lo que tardó, medido por el SERVIDOR
  puntos   int not null default 0,
  momento  timestamptz not null default now(),
  primary key (sesion, alumno, pregunta),
  foreign key (sesion, alumno) references public.directo_participantes(sesion, alumno) on delete cascade
);

-- ---------- Seguridad: todo cerrado; el profesor solo LEE ---------------

do $$
declare t text;
begin
  foreach t in array array['directo_sesiones', 'directo_participantes', 'directo_respuestas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists profe_lee_%s on public.%I', t, t);
    execute format('create policy profe_lee_%s on public.%I for select to authenticated using (public.es_profesor())', t, t);
  end loop;
end $$;

-- ---------- Piezas internas ----------------------------------------------

-- Si la pregunta en curso ya pasó de tiempo (más 1 s de cortesía por la latencia del móvil), la sala pasa sola a «resultado»
-- (se llama al principio de cada función)
create or replace function public._directo_al_dia(p_sesion uuid) returns void
language sql security definer set search_path = public as $$
  update public.directo_sesiones set estado = 'resultado'
   where id = p_sesion and estado = 'pregunta' and now() >= limite + interval '1 second';
$$;

-- La pregunta número `p_n` de una sala, tal como la ve el alumno (SIN solución). Las opciones salen en el orden fijo de la sala.
create or replace function public._directo_pregunta(p_sesion uuid, p_n int) returns jsonb
language sql stable security definer set search_path = public as $$
  select public._item_alumno(i.datos, s.e -> 'ops_orden', s.e ->> 'clave')
    from public.directo_sesiones d
    cross join lateral (select d.preguntas -> p_n as e) s
    join public.items i on i.banco = s.e ->> 'banco' and i.id = s.e ->> 'id'
   where d.id = p_sesion and s.e is not null;
$$;

-- El resultado de la pregunta p_n (SOLO cuando ya está cerrada): la correcta, el porqué y cuántos eligieron cada opción
create or replace function public._directo_resultado(p_sesion uuid, p_n int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e jsonb; datos jsonb; reparto jsonb;
begin
  select d.preguntas -> p_n into e from public.directo_sesiones d where d.id = p_sesion;
  if e is null then return null; end if;
  select i.datos into datos from public.items i where i.banco = e ->> 'banco' and i.id = e ->> 'id';
  if datos is null then return null; end if;
  if datos ->> 'tipo' = 'opcion_multiple' then
    select jsonb_agg(jsonb_build_object('texto', o.t, 'veces', (select count(*) from public.directo_respuestas r
                                                                  where r.sesion = p_sesion and r.pregunta = p_n and r.dada = to_jsonb(o.i - 1)),
                                        'correcta', (o.i - 1) = (datos ->> 'ok')::int) order by o.i)
      into reparto from jsonb_array_elements_text(datos -> 'ops') with ordinality as o(t, i);
  else
    select jsonb_agg(jsonb_build_object('texto', v.t, 'veces', (select count(*) from public.directo_respuestas r
                                                                 where r.sesion = p_sesion and r.pregunta = p_n and r.dada = to_jsonb(v.b)),
                                        'correcta', v.b = (datos ->> 'ok')::boolean) order by v.o)
      into reparto from (values ('Verdadero', true, 1), ('Falso', false, 2)) as v(t, b, o);
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'correcta', datos -> 'ok',
    'sol', datos -> 'sol', 'trampa', datos -> 'trampa', 'reparto', reparto));
end $$;

-- ---------- Funciones del PROFESOR ------------------------------------------

create or replace function public.profe_directo_crear(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text; bancos_j text[]; npreg int; tiempo int; equil text; titulo text; sel jsonb; disp int; cod text; sid uuid; intentos int := 0;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then raise exception 'directo_no_valido: no es un objeto'; end if;

  g := p_datos ->> 'grupo';
  if g is null or not exists (select 1 from public.grupos where id = g) then raise exception 'directo_no_valido: el grupo no existe'; end if;

  if jsonb_typeof(p_datos -> 'bancos') is distinct from 'array' or jsonb_array_length(p_datos -> 'bancos') not between 1 and 10 then
    raise exception 'directo_no_valido: bancos debe ser una lista de 1 a 10 bancos';
  end if;
  if exists (select 1 from jsonb_array_elements(p_datos -> 'bancos') b where jsonb_typeof(b) is distinct from 'string') then
    raise exception 'directo_no_valido: bancos debe ser una lista de textos';
  end if;
  select array_agg(distinct b) into bancos_j from jsonb_array_elements_text(p_datos -> 'bancos') b;
  if (select count(*) from public.bancos where id = any (bancos_j)) <> cardinality(bancos_j) then raise exception 'directo_no_valido: algún banco no existe'; end if;

  if p_datos ? 'preguntas' and (jsonb_typeof(p_datos -> 'preguntas') is distinct from 'number' or (p_datos ->> 'preguntas')::numeric <> trunc((p_datos ->> 'preguntas')::numeric)
                                or (p_datos ->> 'preguntas')::numeric not between 1 and 50) then
    raise exception 'directo_no_valido: preguntas debe ser un entero de 1 a 50';
  end if;
  if p_datos ? 'tiempo_s' and (jsonb_typeof(p_datos -> 'tiempo_s') is distinct from 'number' or (p_datos ->> 'tiempo_s')::numeric <> trunc((p_datos ->> 'tiempo_s')::numeric)
                               or (p_datos ->> 'tiempo_s')::numeric not between 5 and 120) then
    raise exception 'directo_no_valido: tiempo_s debe ser un entero de 5 a 120';
  end if;
  equil := coalesce(p_datos ->> 'equilibrar', 'tema');
  if equil not in ('tema', 'ninguno') then raise exception 'directo_no_valido: equilibrar debe ser «tema» o «ninguno»'; end if;
  if p_datos ? 'titulo' and (jsonb_typeof(p_datos -> 'titulo') is distinct from 'string' or length(btrim(p_datos ->> 'titulo')) not between 1 and 200) then
    raise exception 'directo_no_valido: titulo debe ser un texto de 1 a 200 caracteres';
  end if;
  npreg := coalesce((p_datos ->> 'preguntas')::int, 10);
  tiempo := coalesce((p_datos ->> 'tiempo_s')::int, 20);
  titulo := coalesce(btrim(p_datos ->> 'titulo'), 'Directo');

  -- En directo solo se juegan las preguntas que se ven bien en un proyector: opción múltiple y verdadero/falso
  select count(*) into disp from public.items where banco = any (bancos_j) and tipo in ('opcion_multiple', 'verdadero_falso');
  if disp < npreg then raise exception 'directo_no_valido: pides % preguntas y los bancos solo tienen % de opción múltiple o verdadero/falso', npreg, disp; end if;

  with cand as (
    select i.banco, i.id, i.datos,
           row_number() over (partition by case when equil = 'tema' then coalesce(i.tema, '') else '' end order by random()) as rn
      from public.items i where i.banco = any (bancos_j) and i.tipo in ('opcion_multiple', 'verdadero_falso')
  ), elegidas as (
    select * from cand order by rn, random() limit npreg
  )
  select jsonb_agg(jsonb_build_object('banco', banco, 'id', id, 'clave', banco || '/' || id,
                                      'ops_orden', case when datos ->> 'tipo' = 'opcion_multiple'
                                                        then (select to_jsonb(array_agg(k order by k)) from generate_series(0, jsonb_array_length(datos -> 'ops') - 1) k) end)
                   order by random())
    into sel from elegidas;

  -- Salas olvidadas (más de 12 horas sin cerrar) se cierran solas, y así se libera su código
  update public.directo_sesiones set estado = 'terminada', terminada = now() where estado <> 'terminada' and creada < now() - interval '12 hours';

  loop
    cod := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.directo_sesiones where sala = cod and estado <> 'terminada');
    intentos := intentos + 1;
    if intentos > 50 then raise exception 'directo_sin_codigo'; end if;
  end loop;

  insert into public.directo_sesiones(sala, grupo, titulo, bancos, preguntas, tiempo_s)
  values (cod, g, titulo, bancos_j, sel, tiempo) returning id into sid;
  return jsonb_build_object('ok', true, 'sesion', sid, 'sala', cod, 'total', jsonb_array_length(sel), 'tiempo_s', tiempo);
end $$;

-- Todo lo que necesita la pantalla del profesor / proyector. La solución solo aparece cuando la pregunta está cerrada.
create or replace function public.profe_directo_estado(p_sesion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.directo_sesiones; total int;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  perform public._directo_al_dia(p_sesion);
  select * into s from public.directo_sesiones where id = p_sesion;
  if s.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  total := jsonb_array_length(s.preguntas);
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'sesion', s.id, 'sala', s.sala, 'titulo', s.titulo, 'grupo', s.grupo, 'estado', s.estado,
    'actual', s.actual, 'total', total, 'tiempo_s', s.tiempo_s, 'ahora', now(),
    'restante_ms', case when s.estado = 'pregunta' then greatest(0, round(extract(epoch from s.limite - now()) * 1000))::int end,
    'participantes', coalesce((
      select jsonb_agg(jsonb_build_object('alumno', p.alumno, 'apodo', p.apodo, 'puntos', p.puntos, 'aciertos', p.aciertos, 'conectado', p.visto > now() - interval '8 seconds',
                                          'respondio', s.actual >= 0 and exists (select 1 from public.directo_respuestas r where r.sesion = s.id and r.alumno = p.alumno and r.pregunta = s.actual))
                       order by p.puntos desc, p.apodo)
        from public.directo_participantes p where p.sesion = s.id), '[]'::jsonb),
    'respondidas', case when s.actual >= 0 then (select count(*) from public.directo_respuestas r where r.sesion = s.id and r.pregunta = s.actual) end,
    'pregunta', case when s.actual >= 0 and s.estado <> 'terminada' then public._directo_pregunta(s.id, s.actual) end,
    'resultado', case when s.actual >= 0 and s.estado in ('resultado', 'terminada') then public._directo_resultado(s.id, s.actual) end));
end $$;

-- Un paso adelante. `p_desde` es el estado que el profesor TIENE EN PANTALLA: si mientras tanto la sala cambió sola (se acabó el tiempo),
-- no se avanza dos veces de golpe: devuelve {ok:false, motivo:'estado_cambiado'} y la pantalla se refresca.
create or replace function public.profe_directo_avanzar(p_sesion uuid, p_desde text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.directo_sesiones; total int;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  select * into s from public.directo_sesiones where id = p_sesion for update;
  if s.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  perform public._directo_al_dia(p_sesion);
  select * into s from public.directo_sesiones where id = p_sesion;
  if s.estado is distinct from p_desde then return jsonb_build_object('ok', false, 'motivo', 'estado_cambiado', 'estado', s.estado); end if;
  total := jsonb_array_length(s.preguntas);

  if s.estado = 'espera' then
    update public.directo_sesiones set estado = 'pregunta', actual = 0, abierta = now(), limite = now() + make_interval(secs => s.tiempo_s) where id = s.id;
  elsif s.estado = 'pregunta' then                                       -- cerrar ya
    update public.directo_sesiones set estado = 'resultado', limite = least(limite, now()) where id = s.id;
  elsif s.estado = 'resultado' then
    if s.actual + 1 < total then
      update public.directo_sesiones set estado = 'pregunta', actual = s.actual + 1, abierta = now(), limite = now() + make_interval(secs => s.tiempo_s) where id = s.id;
    else
      update public.directo_sesiones set estado = 'terminada', terminada = now() where id = s.id;
    end if;
  else
    return jsonb_build_object('ok', false, 'motivo', 'terminada');
  end if;
  select * into s from public.directo_sesiones where id = p_sesion;
  return jsonb_build_object('ok', true, 'estado', s.estado, 'actual', s.actual);
end $$;

create or replace function public.profe_directo_terminar(p_sesion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  update public.directo_sesiones set estado = 'terminada', terminada = coalesce(terminada, now()) where id = p_sesion and estado <> 'terminada';
  return jsonb_build_object('ok', exists (select 1 from public.directo_sesiones where id = p_sesion));
end $$;

create or replace function public.profe_directo_activas() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  return jsonb_build_object('ok', true, 'salas', coalesce((
    select jsonb_agg(jsonb_build_object('sesion', s.id, 'sala', s.sala, 'titulo', s.titulo, 'grupo', s.grupo, 'estado', s.estado, 'creada', s.creada,
                                        'participantes', (select count(*) from public.directo_participantes p where p.sesion = s.id)) order by s.creada desc)
      from public.directo_sesiones s where s.estado <> 'terminada'), '[]'::jsonb));
end $$;

create or replace function public.profe_directo_borrar(p_sesion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  delete from public.directo_sesiones where id = p_sesion;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

-- ---------- Funciones del ALUMNO --------------------------------------------

-- Apodos: adjetivo + animal, ambos masculinos. Solo se usan en pantalla; nada que ver con el alumno real.
create or replace function public._directo_apodo(p_sesion uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare adj text[] := array['Azul', 'Rojo', 'Verde', 'Dorado', 'Plateado', 'Veloz', 'Astuto', 'Bravo', 'Sabio', 'Ágil', 'Feliz', 'Sereno', 'Valiente', 'Curioso', 'Listo', 'Fuerte', 'Noble', 'Fiero', 'Rápido', 'Cósmico'];
        ani text[] := array['Zorro', 'Lobo', 'Oso', 'Halcón', 'Tigre', 'León', 'Búho', 'Delfín', 'Lince', 'Cuervo', 'Panda', 'Tiburón', 'Dragón', 'Pulpo', 'Gato', 'Conejo', 'Ciervo', 'Jabalí', 'Lagarto', 'Camaleón', 'Mapache', 'Cóndor', 'Puma', 'Koala', 'Pingüino', 'Erizo', 'Castor', 'Bisonte'];
        a text; k int := 0;
begin
  loop
    a := ani[1 + floor(random() * array_length(ani, 1))::int] || ' ' || adj[1 + floor(random() * array_length(adj, 1))::int];
    k := k + 1;
    if k > 40 then a := a || ' ' || (1 + floor(random() * 99))::int; end if;                 -- sala casi llena de apodos: se añade un número
    exit when not exists (select 1 from public.directo_participantes where sesion = p_sesion and apodo = a);
  end loop;
  return a;
end $$;

-- Entrar en una sala con su código de alumno y el código de sala. Solo el grupo de la sala. Se puede entrar con la sala ya empezada y volver a entrar
-- (recargar) sin perder el apodo ni los puntos.
create or replace function public.directo_unirse(p_codigo text, p_sala text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; s public.directo_sesiones; pt public.directo_participantes; k int := 0;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into s from public.directo_sesiones where sala = p_sala and estado <> 'terminada';
  -- una sala de otro grupo se trata como si no existiera (no se enseña que está abierta)
  if s.id is null or s.grupo <> a.grupo then return jsonb_build_object('ok', false, 'motivo', 'sala'); end if;

  perform pg_advisory_xact_lock(hashtextextended(s.id::text || ':' || a.id, 0));
  select * into pt from public.directo_participantes where sesion = s.id and alumno = a.id;
  if pt.alumno is null then
    loop
      begin
        insert into public.directo_participantes(sesion, alumno, apodo) values (s.id, a.id, public._directo_apodo(s.id)) returning * into pt;
        exit;
      exception when unique_violation then                                                    -- el mismo apodo a la vez para dos alumnos: otro intento
        k := k + 1;
        if k > 20 then raise; end if;
      end;
    end loop;
  else
    update public.directo_participantes set visto = now() where sesion = s.id and alumno = a.id;
  end if;
  return jsonb_build_object('ok', true, 'sesion', s.id, 'apodo', pt.apodo, 'titulo', s.titulo, 'total', jsonb_array_length(s.preguntas));
end $$;

-- Lo que ve el móvil del alumno. Sin soluciones hasta que la pregunta se cierra; entonces, solo SU resultado y el marcador.
create or replace function public.directo_estado(p_codigo text, p_sesion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; s public.directo_sesiones; pt public.directo_participantes; r public.directo_respuestas; res jsonb; pos int; npart int; top jsonb;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  perform public._directo_al_dia(p_sesion);
  select * into s from public.directo_sesiones where id = p_sesion;
  if s.id is null or s.grupo <> a.grupo then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  select * into pt from public.directo_participantes where sesion = s.id and alumno = a.id;
  if pt.alumno is null then return jsonb_build_object('ok', false, 'motivo', 'no_participas'); end if;
  update public.directo_participantes set visto = now() where sesion = s.id and alumno = a.id;

  select count(*) + 1 into pos from public.directo_participantes where sesion = s.id and puntos > pt.puntos;
  select count(*) into npart from public.directo_participantes where sesion = s.id;
  if s.actual >= 0 then select * into r from public.directo_respuestas where sesion = s.id and alumno = a.id and pregunta = s.actual; end if;

  if s.estado in ('resultado', 'terminada') then
    select coalesce(jsonb_agg(jsonb_build_object('apodo', t.apodo, 'puntos', t.puntos, 'yo', t.apodo = pt.apodo) order by t.puntos desc, t.apodo), '[]'::jsonb) into top
      from (select apodo, puntos from public.directo_participantes where sesion = s.id order by puntos desc, apodo limit 5) t;
    res := case when s.actual >= 0 then public._directo_resultado(s.id, s.actual) end;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'sesion', s.id, 'titulo', s.titulo, 'estado', s.estado, 'actual', s.actual, 'total', jsonb_array_length(s.preguntas), 'tiempo_s', s.tiempo_s,
    'apodo', pt.apodo, 'puntos', pt.puntos, 'aciertos', pt.aciertos, 'posicion', pos, 'participantes', npart, 'ahora', now(),
    'restante_ms', case when s.estado = 'pregunta' then greatest(0, round(extract(epoch from s.limite - now()) * 1000))::int end,
    'pregunta', case when s.estado = 'pregunta' then public._directo_pregunta(s.id, s.actual) end,
    'respondio', case when s.actual >= 0 and s.estado <> 'terminada' then r.alumno is not null end,
    'mi_dada', case when s.estado = 'pregunta' then r.dada end,
    'resultado', case when s.estado = 'resultado' and s.actual >= 0
                      then jsonb_build_object('correcta', res -> 'correcta', 'sol', res -> 'sol', 'respondio', r.alumno is not null, 'ok', coalesce(r.ok, false),
                                              'puntos', coalesce(r.puntos, 0), 'dada', r.dada) end,
    'marcador', top));
end $$;

-- Contesta la pregunta en curso. UNA vez (la primera cuenta). No dice si acertó. p_dada: opción múltiple = índice de la opción (0..n-1,
-- en el orden en que se ven, que es fijo); verdadero/falso = true|false.
create or replace function public.directo_responder(p_codigo text, p_sesion uuid, p_pregunta int, p_dada jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; s public.directo_sesiones; e jsonb; datos jsonb; ms int; ok boolean; pts int; filas int;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  perform public._directo_al_dia(p_sesion);
  select * into s from public.directo_sesiones where id = p_sesion;
  if s.id is null or s.grupo <> a.grupo then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if not exists (select 1 from public.directo_participantes where sesion = s.id and alumno = a.id) then return jsonb_build_object('ok', false, 'motivo', 'no_participas'); end if;
  if p_pregunta is distinct from s.actual then return jsonb_build_object('ok', false, 'motivo', 'otra_pregunta'); end if;
  if s.estado <> 'pregunta' then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;

  e := s.preguntas -> s.actual;
  select i.datos into datos from public.items i where i.banco = e ->> 'banco' and i.id = e ->> 'id';
  if datos ->> 'tipo' = 'opcion_multiple' then
    if jsonb_typeof(p_dada) is distinct from 'number' or (p_dada #>> '{}')::numeric <> trunc((p_dada #>> '{}')::numeric)
       or (p_dada #>> '{}')::numeric < 0 or (p_dada #>> '{}')::numeric >= jsonb_array_length(datos -> 'ops') then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
  elsif jsonb_typeof(p_dada) is distinct from 'boolean' then
    return jsonb_build_object('ok', false, 'motivo', 'dato');
  end if;

  ms := least(greatest(round(extract(epoch from now() - s.abierta) * 1000), 0), s.tiempo_s * 1000)::int;
  ok := public._corregir_item(datos, p_dada);
  pts := case when ok then round(1000 * (1 - ms::numeric / (s.tiempo_s * 1000) / 2))::int else 0 end;

  insert into public.directo_respuestas(sesion, alumno, pregunta, dada, ok, ms, puntos) values (s.id, a.id, s.actual, p_dada, ok, ms, pts)
  on conflict (sesion, alumno, pregunta) do nothing;
  get diagnostics filas = row_count;
  if filas = 0 then return jsonb_build_object('ok', false, 'motivo', 'ya_respondida'); end if;
  update public.directo_participantes set puntos = puntos + pts, aciertos = aciertos + case when ok then 1 else 0 end where sesion = s.id and alumno = a.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Permisos -----------------------------------------------------

revoke all on function public._directo_al_dia(uuid)            from public, anon, authenticated;
revoke all on function public._directo_pregunta(uuid, int)     from public, anon, authenticated;
revoke all on function public._directo_resultado(uuid, int)    from public, anon, authenticated;
revoke all on function public._directo_apodo(uuid)            from public, anon, authenticated;
revoke all on function public.directo_unirse(text, text)       from public;
revoke all on function public.directo_estado(text, uuid)       from public;
revoke all on function public.directo_responder(text, uuid, int, jsonb) from public;
grant execute on function public.directo_unirse(text, text)               to anon, authenticated;
grant execute on function public.directo_estado(text, uuid)               to anon, authenticated;
grant execute on function public.directo_responder(text, uuid, int, jsonb) to anon, authenticated;
revoke all on function public.profe_directo_crear(jsonb)       from public, anon;
revoke all on function public.profe_directo_estado(uuid)       from public, anon;
revoke all on function public.profe_directo_avanzar(uuid, text) from public, anon;
revoke all on function public.profe_directo_terminar(uuid)     from public, anon;
revoke all on function public.profe_directo_activas()          from public, anon;
revoke all on function public.profe_directo_borrar(uuid)       from public, anon;
grant execute on function public.profe_directo_crear(jsonb)        to authenticated;
grant execute on function public.profe_directo_estado(uuid)        to authenticated;
grant execute on function public.profe_directo_avanzar(uuid, text) to authenticated;
grant execute on function public.profe_directo_terminar(uuid)      to authenticated;
grant execute on function public.profe_directo_activas()           to authenticated;
grant execute on function public.profe_directo_borrar(uuid)        to authenticated;

-- Comprobación: debe salir 3 (las tablas nuevas), 6 (funciones del profesor) y 3 (funciones del alumno)
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('directo_sesiones', 'directo_participantes', 'directo_respuestas')) as tablas_nuevas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('profe_directo_crear', 'profe_directo_estado', 'profe_directo_avanzar', 'profe_directo_terminar', 'profe_directo_activas', 'profe_directo_borrar')) as funciones_profe_directo,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('directo_unirse', 'directo_estado', 'directo_responder')) as funciones_alumno_directo;

-- =====================================================================
-- COMPROBACIÓN FINAL. Debe salir exactamente esta fila:
--   tablas = 16 · tablas_sin_rls = 0 · alumnos_de_prueba = 5 · funciones_alumno = 12 · funciones_profe = 18
-- =====================================================================
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
     ('grupos', 'alumnos', 'intentos', 'accesos_fallidos', 'profesores', 'latidos', 'bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos',
      'directo_sesiones', 'directo_participantes', 'directo_respuestas')) as tablas,
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as tablas_sin_rls,
  (select count(*) from public.alumnos where grupo = 'PRUEBA') as alumnos_de_prueba,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
     ('entrar', 'guardar_intento', 'latido', 'mis_juegos', 'empezar_partida', 'responder', 'evento', 'terminar_partida', 'mi_resultado',
      'directo_unirse', 'directo_estado', 'directo_responder')) as funciones_alumno,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
     ('profe_alta_alumnos', 'profe_baja_alumno', 'profe_subir_banco', 'profe_borrar_banco', 'profe_crear_juego', 'profe_asignar', 'profe_publicar_notas',
      'profe_borrar_asignacion', 'profe_cerrar_caducadas', 'profe_resultados', 'profe_estadisticas_examen', 'profe_borrar_partida',
      'profe_directo_crear', 'profe_directo_estado', 'profe_directo_avanzar', 'profe_directo_terminar', 'profe_directo_activas', 'profe_directo_borrar')) as funciones_profe;
