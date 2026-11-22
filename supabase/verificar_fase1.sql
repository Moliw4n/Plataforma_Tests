-- =====================================================================
-- Kiron · verificar_fase1.sql
-- SOLO LEE. Se ejecuta DESPUÉS de 06, 07 y 08, para comprobar que la fase 1 quedó bien y cerrada.
-- Devuelve UNA fila con 5 comprobaciones; todas deben salir en  true.
-- =====================================================================
select
  -- 1. Existen las 7 tablas nuevas y todas tienen RLS activada
  (select count(*) = 7 and bool_and(c.relrowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos'))              as tablas_con_rls,

  -- 2. La web pública (anon) NO puede leer ninguna de ellas (ahí están las soluciones)
  (select not bool_or(has_table_privilege('anon', 'public.' || t, 'select'))
     from unnest(array['bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos']) t)           as anon_no_lee_nada,

  -- 3. Están las 6 funciones del alumno y anon puede llamarlas
  (select bool_and(has_function_privilege('anon', f, 'execute'))
     from unnest(array['public.mis_juegos(text)', 'public.empezar_partida(text,bigint)', 'public.responder(text,uuid,text,jsonb,integer)',
                       'public.evento(text,uuid,text,jsonb)', 'public.terminar_partida(text,uuid)', 'public.mi_resultado(text,uuid)']) f)  as funciones_alumno_ok,

  -- 4. Las funciones del profesor NO las puede llamar anon (solo quien ha entrado con su cuenta)
  (select not bool_or(has_function_privilege('anon', f, 'execute'))
     from unnest(array['public.profe_subir_banco(jsonb)', 'public.profe_crear_juego(jsonb)', 'public.profe_publicar_notas(bigint,boolean)',
                       'public.profe_resultados(bigint)', 'public.profe_estadisticas_examen(bigint)', 'public.profe_borrar_partida(uuid)',
                       'public.profe_cerrar_caducadas()']) f)                                                           as funciones_profe_cerradas,

  -- 5. Lo de antes sigue como estaba: los alumnos y la función entrar() siguen ahí
  (select count(*) > 0 from public.alumnos) and has_function_privilege('anon', 'public.entrar(text)', 'execute')        as lo_anterior_intacto;
