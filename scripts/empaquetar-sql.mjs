#!/usr/bin/env node
/* Junta los SQL del proyecto en UN solo archivo para pegar de una vez en el proyecto de PRUEBAS de Supabase:
     node scripts/empaquetar-sql.mjs        (o: npm run empaquetar-sql)   →   supabase/paquete_pruebas.sql
   El archivo generado NO se edita a mano: pruebas/sql-paquete.test.js comprueba que está al día. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARCHIVOS = ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '05_datos_prueba.sql', '06_contenido.sql', '07_examen.sql', '08_panel_examen.sql'];
export const DESTINO = path.join(RAIZ, 'supabase', 'paquete_pruebas.sql');

const CABECERA = `-- =====================================================================
-- Kiron · PAQUETE PARA EL PROYECTO DE PRUEBAS  (archivo GENERADO: no se edita a mano)
-- Lo genera scripts/empaquetar-sql.mjs juntando, por este orden:
--   ${ARCHIVOS.join('\n--   ')}
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
`;

const COMPROBACION = `
-- =====================================================================
-- COMPROBACIÓN FINAL. Debe salir exactamente esta fila:
--   tablas = 13 · tablas_sin_rls = 0 · alumnos_de_prueba = 5 · funciones_alumno = 9 · funciones_profe = 12
-- =====================================================================
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
     ('grupos', 'alumnos', 'intentos', 'accesos_fallidos', 'profesores', 'latidos', 'bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos')) as tablas,
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as tablas_sin_rls,
  (select count(*) from public.alumnos where grupo = 'PRUEBA') as alumnos_de_prueba,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
     ('entrar', 'guardar_intento', 'latido', 'mis_juegos', 'empezar_partida', 'responder', 'evento', 'terminar_partida', 'mi_resultado')) as funciones_alumno,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
     ('profe_alta_alumnos', 'profe_baja_alumno', 'profe_subir_banco', 'profe_borrar_banco', 'profe_crear_juego', 'profe_asignar', 'profe_publicar_notas',
      'profe_borrar_asignacion', 'profe_cerrar_caducadas', 'profe_resultados', 'profe_estadisticas_examen', 'profe_borrar_partida')) as funciones_profe;
`;

export function construirPaquete() {
  const partes = ARCHIVOS.map(f => '\n-- ##################### ' + f + ' #####################\n' + fs.readFileSync(path.join(RAIZ, 'supabase', f), 'utf8').replace(/\s+$/, '') + '\n');
  return CABECERA + partes.join('') + COMPROBACION;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.writeFileSync(DESTINO, construirPaquete());
  console.log('Escrito ' + path.relative(RAIZ, DESTINO) + ' (' + Math.round(fs.statSync(DESTINO).size / 1024) + ' KB, ' + ARCHIVOS.length + ' archivos)');
}
