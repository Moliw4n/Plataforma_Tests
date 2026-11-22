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

-- Si la pregunta en curso ya pasó de tiempo, la sala pasa sola a «resultado» (se llama al principio de cada función)
create or replace function public._directo_al_dia(p_sesion uuid) returns void
language sql security definer set search_path = public as $$
  update public.directo_sesiones set estado = 'resultado'
   where id = p_sesion and estado = 'pregunta' and now() >= limite;
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
      select jsonb_agg(jsonb_build_object('alumno', p.alumno, 'apodo', p.apodo, 'puntos', p.puntos, 'aciertos', p.aciertos,
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

-- ---------- Permisos -----------------------------------------------------

revoke all on function public._directo_al_dia(uuid)            from public, anon, authenticated;
revoke all on function public._directo_pregunta(uuid, int)     from public, anon, authenticated;
revoke all on function public._directo_resultado(uuid, int)    from public, anon, authenticated;
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

-- Comprobación: debe salir 3 (las tablas nuevas) y 6 (las funciones profe_directo_* nuevas)
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('directo_sesiones', 'directo_participantes', 'directo_respuestas')) as tablas_nuevas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('profe_directo_crear', 'profe_directo_estado', 'profe_directo_avanzar', 'profe_directo_terminar', 'profe_directo_activas', 'profe_directo_borrar')) as funciones_profe_directo;
