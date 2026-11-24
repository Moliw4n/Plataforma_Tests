-- =====================================================================
-- Kiron · verificar_fase2.sql
-- SOLO LEE. Se ejecuta DESPUÉS de 09_directo.sql, para comprobar que el directo quedó bien instalado y cerrado.
-- Devuelve UNA fila con 6 comprobaciones; todas deben salir en  true.
-- =====================================================================
select
  -- 1. Existen las 4 tablas nuevas y todas tienen RLS activada
  (select count(*) = 4 and bool_and(c.relrowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('directo_sesiones', 'directo_participantes', 'directo_respuestas', 'directo_expulsados'))                              as tablas_con_rls,

  -- 2. La web pública (anon) NO puede leer ninguna de ellas
  (select not bool_or(has_table_privilege('anon', 'public.' || t, 'select'))
     from unnest(array['directo_sesiones', 'directo_participantes', 'directo_respuestas', 'directo_expulsados']) t)                           as anon_no_lee_nada,

  -- 3. Están las 4 funciones del alumno y anon puede llamarlas
  (select bool_and(has_function_privilege('anon', f, 'execute'))
     from unnest(array['public.directo_unirse(text,text)', 'public.directo_estado(text,uuid)',
                       'public.directo_responder(text,uuid,integer,jsonb)', 'public.directo_apodo(text,uuid,text)']) f)                                         as funciones_alumno_ok,

  -- 4. Las 7 funciones del profesor NO las puede llamar anon (solo quien ha entrado con su cuenta)
  (select not bool_or(has_function_privilege('anon', f, 'execute'))
     from unnest(array['public.profe_directo_crear(jsonb)', 'public.profe_directo_estado(uuid)', 'public.profe_directo_avanzar(uuid,text)',
                       'public.profe_directo_terminar(uuid)', 'public.profe_directo_activas()', 'public.profe_directo_borrar(uuid)', 'public.profe_directo_expulsar(uuid,text)']) f)  as funciones_profe_cerradas,

  -- 5. Las funciones internas están cerradas del todo (ni anon ni authenticated)
  (select not bool_or(has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute'))
     from unnest(array['public._directo_al_dia(uuid)', 'public._directo_pregunta(uuid,integer)', 'public._directo_resultado(uuid,integer)',
                       'public._directo_apodo(uuid)']) f)                                                               as internas_cerradas,

  -- 6. Lo de la fase 1 sigue como estaba (el examen: sus tablas siguen con RLS y entrar() funciona)
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos'))
    and has_function_privilege('anon', 'public.entrar(text)', 'execute')                                                 as lo_anterior_intacto;
