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
