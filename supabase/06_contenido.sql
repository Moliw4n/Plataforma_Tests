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
