/* CONTRATO: el servidor falso del examen (usado por las pruebas de la web) y el SQL real (supabase/07_examen.sql) tienen que
   responder con LA MISMA FORMA en cada paso del mismo guion. Si alguien cambia una función de SQL y no el falso (o al revés),
   esta prueba falla y las pruebas de la web dejan de mentir. Se ejecuta con: npm run test:sql */
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, parar, baseNueva, como, comoUsuario } = require('./ayuda-sql');
const { crearServidorFalso, bancoDePrueba } = require('./servidor-examen-falso');

const PROFE = 'profe@ejemplo.test';
// La «forma» de un JSON: claves y tipos (null vale por cualquier cosa, una lista vacía también)
const forma = v => v === null ? null : Array.isArray(v) ? (v.length ? [forma(v[0])] : []) : typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, forma(v[k])])) : typeof v;
function compatibles(a, b, ruta = '') {
  if (a === null || b === null) return null;
  if (ruta.endsWith('.correcta')) return null;     // la respuesta correcta es texto, número o booleano según el tipo de pregunta
  if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b)) return ruta + ': uno es lista y el otro no'; return a.length && b.length ? compatibles(a[0], b[0], ruta + '[]') : null; }
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== typeof b) return ruta + ': uno es objeto y el otro no';
    const ka = Object.keys(a).sort().join(), kb = Object.keys(b).sort().join();
    if (ka !== kb) return ruta + ': claves distintas · falso {' + ka + '} · real {' + kb + '}';
    for (const k of Object.keys(a)) { const r = compatibles(a[k], b[k], ruta + '.' + k); if (r) return r; }
    return null;
  }
  return typeof a === typeof b ? null : ruta + ': tipo distinto · falso ' + typeof a + ' · real ' + typeof b;
}

let c, falso;
test.before(async () => {
  await iniciar();
  c = await baseNueva('contrato', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '06_contenido.sql', '07_examen.sql']);
  await c.query('insert into profesores(email) values ($1)', [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II'), ('TDA1', 'TDA I')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA1-01', 'TDA1', public._hash_codigo('CCC444'))");
  await comoUsuario(c, PROFE, 'select public.profe_subir_banco($1::jsonb)', [JSON.stringify(bancoDePrueba())]);
  await comoUsuario(c, PROFE, 'select public.profe_crear_juego($1::jsonb)', [JSON.stringify({ id: 'ex', modo: 'examen', titulo: 'Examen de prueba', bancos: ['grande'], reglas: { preguntas: 6, tiempo_min: 20 } })]);
  await comoUsuario(c, PROFE, "select public.profe_asignar('ex', 'TDA2', null, null, 1, true)");
  falso = await crearServidorFalso({ asignacion: { mostrar_soluciones: true } });
});
test.after(parar);

// Tipos de los parámetros de cada función (los jsonb se serializan siempre: un texto suelto no es JSON válido)
const PARAMS = { mis_juegos: [''], empezar_partida: ['', '::bigint'], responder: ['', '::uuid', '', 'json', '::int'], evento: ['', '::uuid', '', 'json'], terminar_partida: ['', '::uuid'], mi_resultado: ['', '::uuid'] };
const real = async (fn, ...args) => {
  const tipos = PARAMS[fn];
  const ph = args.map((_, i) => '$' + (i + 1) + (tipos[i] === 'json' ? '::jsonb' : tipos[i])).join(', ');
  const pa = args.map((a, i) => tipos[i] === 'json' ? (a === null ? null : JSON.stringify(a)) : a);
  return (await como(c, 'anon', 'select public.' + fn + '(' + ph + ') as r', pa)).rows[0].r;
};
// Las preguntas (`items`) y lo contestado (`respondidas`) se comparan aparte, tipo por tipo: al azar no salen en el mismo orden
const sinPreguntas = o => (o && typeof o === 'object' && 'items' in o ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'items' && k !== 'respondidas')) : o);
const ambos = async (nombre, fnReal, fnFalso) => {
  const r = await fnReal(), f = await fnFalso();
  const dif = compatibles(sinPreguntas(f), sinPreguntas(r), nombre);
  assert.equal(dif, null, nombre + ' → ' + dif + '\n  falso: ' + JSON.stringify(forma(sinPreguntas(f))) + '\n  real:  ' + JSON.stringify(forma(sinPreguntas(r))));
  return { r, f };
};

test('el falso y el SQL real responden con la misma forma en cada paso del examen', async () => {
  const cod = 'AAA222';
  // 1) mis_juegos (con y sin asignación para el grupo)
  await ambos('mis_juegos', () => real('mis_juegos', cod), () => falso.llamar('mis_juegos', { p_codigo: cod }));
  await ambos('mis_juegos (código malo)', () => real('mis_juegos', 'ZZZ999'), () => falso.llamar('mis_juegos', { p_codigo: 'ZZZ999' }));
  await ambos('mis_juegos (otro grupo)', () => real('mis_juegos', 'CCC444'), () => falso.llamar('mis_juegos', { p_codigo: 'CCC444' }));
  // 2) empezar
  const asg = (await c.query('select id from asignaciones')).rows[0].id;
  const { r: er, f: ef } = await ambos('empezar_partida', () => real('empezar_partida', cod, asg), () => falso.llamar('empezar_partida', { p_codigo: cod, p_asignacion: 1 }));
  assert.equal(er.items.length, ef.items.length);
  // los tipos presentes en cada uno tienen la misma forma de pregunta
  for (const tipo of ['opcion_multiple', 'verdadero_falso', 'numerica', 'respuesta_corta']) {
    const a = ef.items.find(i => i.tipo === tipo), b = er.items.find(i => i.tipo === tipo);
    if (a && b) assert.equal(compatibles(a, b, 'item ' + tipo), null, 'forma de la pregunta ' + tipo);
  }
  await ambos('empezar_partida (código malo)', () => real('empezar_partida', 'ZZZ999', asg), () => falso.llamar('empezar_partida', { p_codigo: 'ZZZ999', p_asignacion: 1 }));
  // reanudar devuelve lo mismo que empezar
  await ambos('empezar_partida (reanudar)', () => real('empezar_partida', cod, asg), () => falso.llamar('empezar_partida', { p_codigo: cod, p_asignacion: 1 }));
  // 3) responder: cada tipo, bien y rechazado
  const dadaPara = i => i.tipo === 'opcion_multiple' ? 0 : i.tipo === 'verdadero_falso' ? true : 'texto';
  const ires = er.items[0], ifal = ef.items[0];
  await ambos('responder', () => real('responder', cod, er.partida, ires.clave, dadaPara(ires), 1234), () => falso.llamar('responder', { p_codigo: cod, p_partida: ef.partida, p_item: ifal.clave, p_dada: dadaPara(ifal), p_ms: 1234 }));
  await ambos('responder (dato malo)', () => real('responder', cod, er.partida, ires.clave, 'x', null), () => falso.llamar('responder', { p_codigo: cod, p_partida: ef.partida, p_item: ifal.clave, p_dada: 'x', p_ms: null }));
  await ambos('responder (item que no está)', () => real('responder', cod, er.partida, 'grande/nada', 1, null), () => falso.llamar('responder', { p_codigo: cod, p_partida: ef.partida, p_item: 'grande/nada', p_dada: 1, p_ms: null }));
  // 4) evento
  await ambos('evento', () => real('evento', cod, er.partida, 'salida', { segundos: 3 }), () => falso.llamar('evento', { p_codigo: cod, p_partida: ef.partida, p_tipo: 'salida', p_detalle: { segundos: 3 } }));
  await ambos('evento (tipo malo)', () => real('evento', cod, er.partida, 'trampa', null), () => falso.llamar('evento', { p_codigo: cod, p_partida: ef.partida, p_tipo: 'trampa', p_detalle: null }));
  // 5) resultado en curso, entregar, resultado sin publicar, publicado con revisión
  await ambos('mi_resultado (en curso)', () => real('mi_resultado', cod, er.partida), () => falso.llamar('mi_resultado', { p_codigo: cod, p_partida: ef.partida }));
  await ambos('terminar_partida', () => real('terminar_partida', cod, er.partida), () => falso.llamar('terminar_partida', { p_codigo: cod, p_partida: ef.partida }));
  await ambos('terminar_partida (otra vez)', () => real('terminar_partida', cod, er.partida), () => falso.llamar('terminar_partida', { p_codigo: cod, p_partida: ef.partida }));
  await ambos('responder (ya entregada)', () => real('responder', cod, er.partida, ires.clave, 1, null), () => falso.llamar('responder', { p_codigo: cod, p_partida: ef.partida, p_item: ifal.clave, p_dada: 1, p_ms: null }));
  await ambos('mi_resultado (sin publicar)', () => real('mi_resultado', cod, er.partida), () => falso.llamar('mi_resultado', { p_codigo: cod, p_partida: ef.partida }));
  await ambos('empezar_partida (sin intentos)', () => real('empezar_partida', cod, asg), () => falso.llamar('empezar_partida', { p_codigo: cod, p_asignacion: 1 }));
  await comoUsuario(c, PROFE, 'select public.profe_publicar_notas($1::bigint, true)', [asg]); falso.publicarNotas(true);
  const { r: pr } = await ambos('mi_resultado (publicado, con revisión)', () => real('mi_resultado', cod, er.partida), () => falso.llamar('mi_resultado', { p_codigo: cod, p_partida: ef.partida }));
  assert.ok(Array.isArray(pr.revision) && pr.revision.length === 6);
  await ambos('mis_juegos (con nota publicada)', () => real('mis_juegos', cod), () => falso.llamar('mis_juegos', { p_codigo: cod }));
});
