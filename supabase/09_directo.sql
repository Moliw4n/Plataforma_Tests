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

-- Añadidos después del primer 09 (se pueden ejecutar encima de una instalación anterior):
--   lectura_s   segundos entre que sale la pregunta y salen las opciones (el tiempo de contestar empieza DESPUÉS); 0 = sin pausa
--   apodo_libre true = cada alumno puede cambiarse el apodo en la espera (si no, el servidor se lo da y no se cambia)
alter table public.directo_sesiones add column if not exists lectura_s   int     not null default 0 check (lectura_s between 0 and 10);
alter table public.directo_sesiones add column if not exists apodo_libre boolean not null default false;

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

-- Quien el profesor saca de una sala no puede volver a entrar en ESA sala
create table if not exists public.directo_expulsados (
  sesion  uuid not null references public.directo_sesiones(id) on delete cascade,
  alumno  text not null references public.alumnos(id) on update cascade on delete cascade,
  primary key (sesion, alumno)
);

-- ---------- Seguridad: todo cerrado; el profesor solo LEE ---------------

do $$
declare t text;
begin
  foreach t in array array['directo_sesiones', 'directo_participantes', 'directo_respuestas', 'directo_expulsados'] loop
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
  select case when d.estado = 'pregunta' and d.actual = p_n and now() < d.abierta     -- en la pausa de lectura: solo el enunciado, sin opciones
              then public._item_alumno(i.datos, s.e -> 'ops_orden', s.e ->> 'clave') - 'ops'
              else public._item_alumno(i.datos, s.e -> 'ops_orden', s.e ->> 'clave') end
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
declare g text; bancos_j text[]; npreg int; tiempo int; lect int; libre boolean; equil text; titulo text; sel jsonb; disp int; cod text; sid uuid; intentos int := 0;
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
  if p_datos ? 'lectura_s' and (jsonb_typeof(p_datos -> 'lectura_s') is distinct from 'number' or (p_datos ->> 'lectura_s')::numeric <> trunc((p_datos ->> 'lectura_s')::numeric)
                                or (p_datos ->> 'lectura_s')::numeric not between 0 and 10) then
    raise exception 'directo_no_valido: lectura_s debe ser un entero de 0 a 10';
  end if;
  if p_datos ? 'apodo_libre' and jsonb_typeof(p_datos -> 'apodo_libre') is distinct from 'boolean' then
    raise exception 'directo_no_valido: apodo_libre debe ser verdadero o falso';
  end if;
  lect := coalesce((p_datos ->> 'lectura_s')::int, 0);
  libre := coalesce((p_datos ->> 'apodo_libre')::boolean, false);
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

  insert into public.directo_sesiones(sala, grupo, titulo, bancos, preguntas, tiempo_s, lectura_s, apodo_libre)
  values (cod, g, titulo, bancos_j, sel, tiempo, lect, libre) returning id into sid;
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
    'lectura_ms', case when s.estado = 'pregunta' then greatest(0, round(extract(epoch from s.abierta - now()) * 1000))::int end,
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
    update public.directo_sesiones set estado = 'pregunta', actual = 0, abierta = now() + make_interval(secs => s.lectura_s), limite = now() + make_interval(secs => s.lectura_s + s.tiempo_s) where id = s.id;
  elsif s.estado = 'pregunta' then                                       -- cerrar ya
    update public.directo_sesiones set estado = 'resultado', limite = least(limite, now()) where id = s.id;
  elsif s.estado = 'resultado' then
    if s.actual + 1 < total then
      update public.directo_sesiones set estado = 'pregunta', actual = s.actual + 1, abierta = now() + make_interval(secs => s.lectura_s), limite = now() + make_interval(secs => s.lectura_s + s.tiempo_s) where id = s.id;
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

-- Sacar a un alumno de la sala (por un apodo que no toca, por ejemplo): se borran su entrada y sus respuestas y no puede volver a entrar en esa sala.
create or replace function public.profe_directo_expulsar(p_sesion uuid, p_alumno text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  if not exists (select 1 from public.directo_sesiones where id = p_sesion) then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if not exists (select 1 from public.directo_participantes where sesion = p_sesion and alumno = p_alumno) then return jsonb_build_object('ok', false, 'motivo', 'no_participa'); end if;
  insert into public.directo_expulsados(sesion, alumno) values (p_sesion, p_alumno) on conflict do nothing;
  delete from public.directo_participantes where sesion = p_sesion and alumno = p_alumno;        -- sus respuestas se van con él (on delete cascade)
  return jsonb_build_object('ok', true);
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

  if exists (select 1 from public.directo_expulsados where sesion = s.id and alumno = a.id) then return jsonb_build_object('ok', false, 'motivo', 'expulsado'); end if;

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
  return jsonb_build_object('ok', true, 'sesion', s.id, 'apodo', pt.apodo, 'titulo', s.titulo, 'total', jsonb_array_length(s.preguntas), 'apodo_libre', s.apodo_libre);
end $$;

-- Cambiarse el apodo: SOLO si el profesor activó «apodo libre» y SOLO mientras la sala está en espera. De 2 a 16 caracteres, sin símbolos raros,
-- sin repetir uno que ya esté en la sala (sin distinguir mayúsculas). Lo que escriba se ve en el proyector: el profesor puede sacar de la sala a quien abuse.
create or replace function public.directo_apodo(p_codigo text, p_sesion uuid, p_apodo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; s public.directo_sesiones; n text;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into s from public.directo_sesiones where id = p_sesion;
  if s.id is null or s.grupo <> a.grupo then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if not exists (select 1 from public.directo_participantes where sesion = s.id and alumno = a.id) then return jsonb_build_object('ok', false, 'motivo', 'no_participas'); end if;
  if not s.apodo_libre then return jsonb_build_object('ok', false, 'motivo', 'no_libre'); end if;
  perform public._directo_al_dia(s.id);
  if s.estado <> 'espera' then return jsonb_build_object('ok', false, 'motivo', 'empezada'); end if;
  n := regexp_replace(btrim(coalesce(p_apodo, '')), '\s+', ' ', 'g');
  if length(n) not between 2 and 16 or n ~ '[[:cntrl:]<>]' then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
  if exists (select 1 from public.directo_participantes where sesion = s.id and lower(apodo) = lower(n) and alumno <> a.id) then return jsonb_build_object('ok', false, 'motivo', 'ocupado'); end if;
  begin
    update public.directo_participantes set apodo = n, visto = now() where sesion = s.id and alumno = a.id;
  exception when unique_violation then return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;
  return jsonb_build_object('ok', true, 'apodo', n);
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
    'lectura_ms', case when s.estado = 'pregunta' then greatest(0, round(extract(epoch from s.abierta - now()) * 1000))::int end,
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
  if now() < s.abierta then return jsonb_build_object('ok', false, 'motivo', 'aun_no'); end if;       -- todavía en la pausa de lectura

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
revoke all on function public.directo_apodo(text, uuid, text)  from public;
grant execute on function public.directo_apodo(text, uuid, text)          to anon, authenticated;
grant execute on function public.directo_unirse(text, text)               to anon, authenticated;
grant execute on function public.directo_estado(text, uuid)               to anon, authenticated;
grant execute on function public.directo_responder(text, uuid, int, jsonb) to anon, authenticated;
revoke all on function public.profe_directo_crear(jsonb)       from public, anon;
revoke all on function public.profe_directo_estado(uuid)       from public, anon;
revoke all on function public.profe_directo_avanzar(uuid, text) from public, anon;
revoke all on function public.profe_directo_terminar(uuid)     from public, anon;
revoke all on function public.profe_directo_activas()          from public, anon;
revoke all on function public.profe_directo_borrar(uuid)       from public, anon;
revoke all on function public.profe_directo_expulsar(uuid, text) from public, anon;
grant execute on function public.profe_directo_expulsar(uuid, text) to authenticated;
grant execute on function public.profe_directo_crear(jsonb)        to authenticated;
grant execute on function public.profe_directo_estado(uuid)        to authenticated;
grant execute on function public.profe_directo_avanzar(uuid, text) to authenticated;
grant execute on function public.profe_directo_terminar(uuid)      to authenticated;
grant execute on function public.profe_directo_activas()           to authenticated;
grant execute on function public.profe_directo_borrar(uuid)        to authenticated;

-- Comprobación: debe salir 4 (las tablas nuevas), 7 (funciones del profesor) y 4 (funciones del alumno)
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('directo_sesiones', 'directo_participantes', 'directo_respuestas', 'directo_expulsados')) as tablas_nuevas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('profe_directo_crear', 'profe_directo_estado', 'profe_directo_avanzar', 'profe_directo_terminar', 'profe_directo_activas', 'profe_directo_borrar', 'profe_directo_expulsar')) as funciones_profe_directo,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('directo_unirse', 'directo_estado', 'directo_responder', 'directo_apodo')) as funciones_alumno_directo;
