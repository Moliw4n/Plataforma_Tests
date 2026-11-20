/* CONTRATO del panel: el Supabase falso del panel (pruebas/servidor-panel-falso.js) y el SQL real (06, 07 y 08) responden con la misma
   FORMA en las funciones profe_*. Incluye los datos de ejemplo de resultados y estadísticas (datosExamen): si no se parecen a lo que
   devuelve el servidor de verdad, esta prueba falla. Se ejecuta con: npm run test:sql */
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, parar, baseNueva, como, comoUsuario } = require('./ayuda-sql');
const { crearServidorPanel, datosExamen } = require('./servidor-panel-falso');
const { bancoDePrueba } = require('./servidor-examen-falso');

const PROFE = 'profe@ejemplo.test';
const compatibles = (a, b, ruta = '') => {
  if (a === null || b === null) return null;
  if (ruta.endsWith('.dada')) return null;           // lo contestado es número, booleano o texto según el tipo de pregunta
  if (ruta.endsWith('.por_criterio')) return Object.values(a).concat(Object.values(b)).every(v => typeof v === 'number') ? null : ruta + ': los valores deben ser números';   // diccionario: las claves son los criterios que haya
  if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b)) return ruta + ': uno es lista y el otro no'; return a.length && b.length ? compatibles(a[0], b[0], ruta + '[]') : null; }
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== typeof b) return ruta + ': uno es objeto y el otro no';
    const ka = Object.keys(a).sort().join(), kb = Object.keys(b).sort().join();
    if (ka !== kb) return ruta + ': claves distintas · falso {' + ka + '} · real {' + kb + '}';
    for (const k of Object.keys(a)) { const r = compatibles(a[k], b[k], ruta + '.' + k); if (r) return r; }
    return null;
  }
  return typeof a === typeof b ? null : ruta + ': tipo distinto · falso ' + typeof a + ' · real ' + typeof b;
};

let c, falso;
const profe = (sql, p) => comoUsuario(c, PROFE, sql, p);
const real = async (fn, args) => {
  const marc = Object.keys(args).map((k, i) => '$' + (i + 1) + (typeof args[k] === 'object' && args[k] !== null ? '::jsonb' : typeof args[k] === 'number' && k === 'p_asignacion' ? '::bigint' : '')).join(', ');
  const valores = Object.values(args).map(v => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
  return (await profe('select public.' + fn + '(' + marc + ') as r', valores)).rows[0].r;
};
const falsa = (fn, args) => falso.rpc(fn, args, { authorization: 'Bearer ' + falso.token }).body;
const mismaForma = (nombre, r, f) => { const d = compatibles(f, r, nombre); assert.equal(d, null, nombre + ' → ' + d + '\n  real:  ' + JSON.stringify(r).slice(0, 400) + '\n  falso: ' + JSON.stringify(f).slice(0, 400)); };

test.before(async () => {
  await iniciar();
  c = await baseNueva('contrato_panel', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '06_contenido.sql', '07_examen.sql', '08_panel_examen.sql']);
  await c.query('insert into profesores(email) values ($1)', [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA2-02', 'TDA2', public._hash_codigo('BBB333'))");
  falso = await crearServidorPanel({});
});
test.after(parar);

test('las funciones profe_* del panel: el falso y el SQL real responden con la misma forma', async () => {
  // un banco con criterios, para que por_criterio no salga vacío
  const banco = bancoDePrueba(); banco.preguntas.forEach((p, i) => { p.criterio = i % 2 ? '2.1' : '2.2'; });
  falso.grupos.push({ id: 'TDA2', nombre: 'TDA II' });
  mismaForma('profe_subir_banco', await real('profe_subir_banco', { p_banco: banco }), falsa('profe_subir_banco', { p_banco: banco }));
  const juego = { id: 'ex1', modo: 'examen', titulo: 'Examen', bancos: ['grande'], reglas: { preguntas: 12, tiempo_min: 20 } };   // todas las del banco: el escenario no depende del azar
  mismaForma('profe_crear_juego', await real('profe_crear_juego', { p_juego: juego }), falsa('profe_crear_juego', { p_juego: juego }));
  const asg = { p_juego: 'ex1', p_grupo: 'TDA2', p_desde: null, p_hasta: null, p_intentos: 2, p_mostrar_soluciones: false };
  const ra = await real('profe_asignar', asg);
  mismaForma('profe_asignar', ra, falsa('profe_asignar', asg));

  // dos alumnos hacen el examen: uno sale de la pestaña y deja preguntas en blanco
  const anon = (sql, p) => como(c, 'anon', sql, p);
  const fuente = clave => banco.preguntas.find(p => p.id === clave.split('/')[1]);
  for (const [cod, buenas] of [['AAA222', true], ['BBB333', false]]) {
    const r = (await anon('select public.empezar_partida($1, $2::bigint) as r', [cod, ra.asignacion])).rows[0].r;
    for (const i of r.items.slice(0, 4)) {
      const f = fuente(i.clave); let dada;
      if (f.tipo === 'opcion_multiple') dada = i.ops.indexOf(f.ops[buenas ? f.ok : (f.ok + 1) % f.ops.length]);
      else if (f.tipo === 'verdadero_falso') dada = buenas ? f.ok : !f.ok; else dada = buenas ? String(f.valor ?? f.aceptadas?.[0]) : 'nada';
      await anon('select public.responder($1, $2::uuid, $3, $4::jsonb)', [cod, r.partida, i.clave, JSON.stringify(dada)]);
    }
    await anon("select public.evento($1, $2::uuid, 'salida')", [cod, r.partida]);
    await anon("select public.evento($1, $2::uuid, 'vuelta', '{\"segundos\": 7}'::jsonb)", [cod, r.partida]);
    await anon('select public.terminar_partida($1, $2::uuid)', [cod, r.partida]);
  }
  // los datos de ejemplo del falso (lo que usan las pruebas de pantalla) tienen la forma de lo que da el servidor de verdad
  const ejemplo = datosExamen();
  falso.asignaciones.push(...ejemplo.asignaciones); falso.juegos.push(...ejemplo.juegos); falso.resultados = ejemplo.resultados; falso.estadisticas = ejemplo.estadisticas;
  const rr = await real('profe_resultados', { p_asignacion: ra.asignacion });
  assert.equal(rr.partidas.length, 2);
  mismaForma('profe_resultados', rr, falsa('profe_resultados', { p_asignacion: 1 }));
  assert.ok(Object.keys(rr.partidas[0].por_criterio).length > 0, 'el escenario debería dar por_criterio');
  const er = await real('profe_estadisticas_examen', { p_asignacion: ra.asignacion });
  assert.ok(er.preguntas.length > 0);
  mismaForma('profe_estadisticas_examen', er, falsa('profe_estadisticas_examen', { p_asignacion: 1 }));
  const mc = er.preguntas.find(q => q.tipo === 'opcion_multiple' && q.reparto);
  mismaForma('profe_estadisticas_examen (opción múltiple)', mc, falsa('profe_estadisticas_examen', { p_asignacion: 1 }).preguntas[0]);

  mismaForma('profe_publicar_notas', await real('profe_publicar_notas', { p_asignacion: ra.asignacion, p_publicar: true }), falsa('profe_publicar_notas', { p_asignacion: 1, p_publicar: true }));
  mismaForma('profe_cerrar_caducadas', await real('profe_cerrar_caducadas', {}), falsa('profe_cerrar_caducadas', {}));
  const partida = rr.partidas[0].partida;
  mismaForma('profe_borrar_partida', await real('profe_borrar_partida', { p_id: partida }), falsa('profe_borrar_partida', { p_id: 'aaaaaaaa-0000-4000-8000-000000000001' }));
  mismaForma('profe_borrar_partida (no existe)', await real('profe_borrar_partida', { p_id: '00000000-0000-0000-0000-000000000000' }), falsa('profe_borrar_partida', { p_id: 'no-existe' }));
  // borrar un banco que ningún juego usa
  const solo = { ...bancoDePrueba(), id: 'suelto', titulo: 'Suelto' };
  await real('profe_subir_banco', { p_banco: solo }); falsa('profe_subir_banco', { p_banco: solo });
  mismaForma('profe_borrar_banco', await real('profe_borrar_banco', { p_id: 'suelto' }), falsa('profe_borrar_banco', { p_id: 'suelto' }));
});
