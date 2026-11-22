/* Pruebas de supabase/08_panel_examen.sql contra un Postgres REAL y LOCAL. Se ejecuta con: npm run test:sql */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SQL, iniciar, parar, baseNueva, como, comoUsuario } = require('./ayuda-sql');

const PROFE = 'profe@ejemplo.test', OTRO = 'otro@ejemplo.test';
const it = (id, extra) => ({ id, enun: 'Enunciado ' + id, sol: 'SOL-' + id, trampa: 'TR-' + id, ...extra });
const BANCO = { formato: 2, id: 'b', titulo: 'Banco', preguntas: [
  it('p1', { tipo: 'opcion_multiple', ops: ['uno', 'dos', 'tres', 'cuatro'], ok: 1, tema: 'x', criterio: '2.1' }),
  it('p2', { tipo: 'opcion_multiple', ops: ['a', 'b', 'c', 'd'], ok: 0, tema: 'x', criterio: '2.1' }),
  it('p3', { tipo: 'verdadero_falso', ok: true, tema: 'y', criterio: '2.2' }),
  it('p4', { tipo: 'respuesta_corta', aceptadas: ['ram'], tema: 'y' }) ] };

let c;
test.before(async () => { await iniciar(); c = await baseNueva('panel', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '06_contenido.sql', '07_examen.sql', '08_panel_examen.sql']); });
test.after(parar);

const profe = (sql, p) => comoUsuario(c, PROFE, sql, p);
const anon = (sql, p) => como(c, 'anon', sql, p);
let ASG;
test.beforeEach(async () => {
  await c.query('truncate eventos, respuestas, partidas, asignaciones, juegos, items, bancos, alumnos, grupos, profesores, accesos_fallidos cascade');
  await c.query('insert into profesores(email) values ($1)', [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA2-02', 'TDA2', public._hash_codigo('BBB333')), ('TDA2-03', 'TDA2', public._hash_codigo('CCC444'))");
  await profe('select public.profe_subir_banco($1::jsonb)', [JSON.stringify(BANCO)]);
  await profe('select public.profe_crear_juego($1::jsonb)', [JSON.stringify({ id: 'ex', modo: 'examen', titulo: 'Examen', bancos: ['b'], reglas: { preguntas: 4, tiempo_min: 30 } })]);
  ASG = (await profe("select public.profe_asignar('ex', 'TDA2', null, null, 2, false) as r")).rows[0].r.asignacion;
});
const empezar = async cod => (await anon('select public.empezar_partida($1, $2::bigint) as r', [cod, ASG])).rows[0].r;
const responder = (cod, p, item, dada) => anon('select public.responder($1, $2::uuid, $3, $4::jsonb)', [cod, p, item, JSON.stringify(dada)]);
const terminar = (cod, p) => anon('select public.terminar_partida($1, $2::uuid)', [cod, p]);
const resultados = async () => (await profe('select public.profe_resultados($1::bigint) as r', [ASG])).rows[0].r;
// Contesta como se indique: mapa clave → 'bien' | 'mal'
async function examen(cod, plan) {
  const r = await empezar(cod);
  for (const i of r.items) {
    const id = i.clave.split('/')[1], hace = plan[id]; if (!hace) continue;
    const p = BANCO.preguntas.find(q => q.id === id);
    let dada;
    if (p.tipo === 'opcion_multiple') dada = i.ops.indexOf(p.ops[hace === 'bien' ? p.ok : (p.ok + 1) % 4]);
    else if (p.tipo === 'verdadero_falso') dada = hace === 'bien' ? p.ok : !p.ok;
    else dada = hace === 'bien' ? p.aceptadas[0] : 'otra cosa';
    await responder(cod, r.partida, i.clave, dada);
  }
  return r;
}

test('08 se puede ejecutar dos veces seguidas', async () => { await c.query(SQL('08_panel_examen.sql')); await c.query(SQL('08_panel_examen.sql')); });

test.describe('permisos', () => {
  test('anon: permiso denegado; una sesión que no es profesor: no_autorizado', async () => {
    for (const sql of ['select public.profe_resultados(1)', 'select public.profe_estadisticas_examen(1)', "select public.profe_borrar_partida('00000000-0000-0000-0000-000000000000')"]) {
      await assert.rejects(anon(sql), /permission denied/, sql);
      await assert.rejects(comoUsuario(c, OTRO, sql), /no_autorizado/, sql);
    }
  });
});

test.describe('profe_resultados', () => {
  test('una asignación sin partidas: lista vacía; una que no existe: no_encontrada', async () => {
    const r = await resultados();
    assert.equal(r.ok, true); assert.deepEqual(r.partidas, []);
    assert.deepEqual(r.asignacion, { id: ASG, juego: 'ex', titulo: 'Examen', grupo: 'TDA2', desde: null, hasta: null, intentos: 2, mostrar_soluciones: false, notas_publicadas: false });
    assert.deepEqual((await profe('select public.profe_resultados(99999) as r')).rows[0].r, { ok: false, motivo: 'no_encontrada' });
  });
  test('cada partida sale en el resultado normalizado (partida, alumno, juego, nota, puntos, segundos, por_criterio, respuestas)', async () => {
    const r1 = await examen('AAA222', { p1: 'bien', p2: 'bien', p3: 'bien', p4: 'mal' }); await terminar('AAA222', r1.partida);
    const x = (await resultados()).partidas;
    assert.equal(x.length, 1);
    const p = x[0];
    for (const k of ['partida', 'alumno', 'juego', 'nota', 'puntos', 'segundos', 'por_criterio', 'respuestas']) assert.ok(k in p, 'falta ' + k);
    assert.deepEqual({ alumno: p.alumno, juego: p.juego, estado: p.estado, intento: p.intento, total: p.total, aciertos: p.aciertos, nota: Number(p.nota), puntos: p.puntos },
      { alumno: 'TDA2-01', juego: 'ex', estado: 'entregada', intento: 1, total: 4, aciertos: 3, nota: 7.5, puntos: 0 });
    assert.ok(Number.isInteger(p.segundos) && p.segundos >= 0);
    assert.equal(p.respuestas.length, 4);
    assert.ok(p.respuestas.every(r => r.respondida));
  });
  test('por_criterio: la fracción de aciertos en las preguntas de cada criterio (las sin criterio no cuentan)', async () => {
    const r1 = await examen('AAA222', { p1: 'bien', p2: 'mal', p3: 'bien', p4: 'bien' }); await terminar('AAA222', r1.partida);
    assert.deepEqual((await resultados()).partidas[0].por_criterio, { '2.1': 0.5, '2.2': 1 });
  });
  test('lo no contestado sale como respondida:false, ok:false (y cuenta como fallo)', async () => {
    const r1 = await examen('AAA222', { p1: 'bien' }); await terminar('AAA222', r1.partida);
    const p = (await resultados()).partidas[0];
    assert.equal(p.respuestas.filter(r => r.respondida).length, 1);
    assert.equal(p.respuestas.filter(r => !r.respondida && r.ok === false).length, 3);
    assert.equal(Number(p.nota), 2.5);
  });
  test('la nota la ve siempre el profesor, publicada o no; y los alumnos de otro orden salen ordenados por alumno e intento', async () => {
    const rb = await examen('BBB333', { p1: 'bien' }); await terminar('BBB333', rb.partida);
    const ra = await examen('AAA222', { p1: 'bien', p2: 'bien' }); await terminar('AAA222', ra.partida);
    const ra2 = await examen('AAA222', { p1: 'bien', p2: 'bien', p3: 'bien', p4: 'bien' }); await terminar('AAA222', ra2.partida);
    const p = (await resultados()).partidas;
    assert.deepEqual(p.map(x => x.alumno + '#' + x.intento), ['TDA2-01#1', 'TDA2-01#2', 'TDA2-02#1']);
    assert.deepEqual(p.map(x => Number(x.nota)), [5, 10, 2.5]);
  });
  test('eventos: salidas, vueltas, recargas, cortes de red y los segundos fuera', async () => {
    const r1 = await empezar('AAA222');
    const ev = (t, d) => anon('select public.evento($1, $2::uuid, $3, $4::jsonb)', ['AAA222', r1.partida, t, d ? JSON.stringify(d) : null]);
    await ev('salida'); await ev('vuelta', { segundos: 12 }); await ev('salida'); await ev('vuelta', { segundos: 30 }); await ev('recarga'); await ev('sin_red', { segundos: 5 });
    await ev('vuelta', { segundos: 'mucho' });          // detalle raro: no rompe la suma
    assert.deepEqual((await resultados()).partidas[0].eventos, { salidas: 2, vueltas: 3, recargas: 1, sin_red: 1, segundos_fuera: 42 });
  });
  test('una partida con el tiempo pasado se cierra sola al pedir los resultados', async () => {
    const r1 = await examen('AAA222', { p1: 'bien', p2: 'bien' });
    await c.query("update partidas set limite = now() - interval '5 minutes'");
    const p = (await resultados()).partidas[0];
    assert.equal(p.estado, 'caducada'); assert.equal(Number(p.nota), 5);
  });
  test('partidas en curso: sin nota todavía', async () => {
    await examen('AAA222', { p1: 'bien' });
    const p = (await resultados()).partidas[0];
    assert.equal(p.estado, 'en_curso'); assert.equal(p.nota, null); assert.equal(p.terminada, null); assert.equal(p.segundos, null);
  });
});

test.describe('profe_estadisticas_examen', () => {
  test('por pregunta: aciertos, fallos, en blanco y % de fallo, de más a menos falladas', async () => {
    // 3 alumnos; p1: bien, bien, mal · p3: bien, mal, en blanco
    const planes = [{ p1: 'bien', p2: 'bien', p3: 'bien', p4: 'bien' }, { p1: 'bien', p2: 'mal', p3: 'mal', p4: 'bien' }, { p1: 'mal', p2: 'bien', p4: 'bien' }];
    for (const [k, cod] of ['AAA222', 'BBB333', 'CCC444'].entries()) { const r = await examen(cod, planes[k]); await terminar(cod, r.partida); }
    const e = (await profe('select public.profe_estadisticas_examen($1::bigint) as r', [ASG])).rows[0].r;
    assert.equal(e.ok, true); assert.equal(e.partidas, 3);
    const por = Object.fromEntries(e.preguntas.map(q => [q.clave.split('/')[1], q]));
    assert.deepEqual({ n: por.p1.n, ac: por.p1.aciertos, fa: por.p1.fallos, bl: por.p1.blancos, pct: Number(por.p1.pct_fallo) }, { n: 3, ac: 2, fa: 1, bl: 0, pct: 33.3 });
    assert.deepEqual({ n: por.p3.n, ac: por.p3.aciertos, fa: por.p3.fallos, bl: por.p3.blancos, pct: Number(por.p3.pct_fallo) }, { n: 3, ac: 1, fa: 1, bl: 1, pct: 66.7 });
    assert.equal(e.preguntas[0].clave, 'b/p3');                                  // la más fallada, primero
    assert.equal(por.p4.pct_fallo === 0 || Number(por.p4.pct_fallo) === 0, true);
  });
  test('reparto de respuestas en opción múltiple, en el orden original de las opciones', async () => {
    for (const cod of ['AAA222', 'BBB333']) { const r = await examen(cod, { p1: cod === 'AAA222' ? 'bien' : 'mal' }); await terminar(cod, r.partida); }
    const e = (await profe('select public.profe_estadisticas_examen($1::bigint) as r', [ASG])).rows[0].r;
    const p1 = e.preguntas.find(q => q.clave === 'b/p1');
    assert.deepEqual(p1.reparto.map(x => x.texto), ['uno', 'dos', 'tres', 'cuatro']);
    assert.deepEqual(p1.reparto.map(x => x.correcta), [false, true, false, false]);
    assert.equal(p1.reparto.reduce((s, x) => s + Number(x.veces), 0), 2);
    assert.equal(Number(p1.reparto[1].veces), 1);                                // «dos» (la correcta) la eligió uno
    assert.equal(e.preguntas.find(q => q.clave === 'b/p3').reparto, null);       // solo en opción múltiple
  });
  test('las partidas en curso no cuentan; sin partidas cerradas, lista vacía; asignación inexistente, no_encontrada', async () => {
    await examen('AAA222', { p1: 'bien' });
    const e = (await profe('select public.profe_estadisticas_examen($1::bigint) as r', [ASG])).rows[0].r;
    assert.equal(e.partidas, 0); assert.deepEqual(e.preguntas, []);
    assert.deepEqual((await profe('select public.profe_estadisticas_examen(99999) as r')).rows[0].r, { ok: false, motivo: 'no_encontrada' });
  });
});

test.describe('profe_borrar_partida', () => {
  test('borra la partida con sus respuestas y eventos, y el alumno puede volver a empezar', async () => {
    await profe("select public.profe_asignar('ex', 'TDA2', null, null, 1, false)");        // un solo intento
    const r1 = await examen('AAA222', { p1: 'bien' }); await terminar('AAA222', r1.partida);
    assert.equal((await empezar('AAA222')).motivo, 'sin_intentos');
    assert.deepEqual((await profe('select public.profe_borrar_partida($1::uuid) as r', [r1.partida])).rows[0].r, { ok: true });
    for (const t of ['partidas', 'respuestas', 'eventos']) assert.equal((await c.query('select count(*)::int n from ' + t)).rows[0].n, 0, t);
    const r2 = await empezar('AAA222');
    assert.equal(r2.ok, true); assert.notEqual(r2.partida, r1.partida);
  });
  test('una partida que no existe da ok:false', async () => {
    assert.deepEqual((await profe("select public.profe_borrar_partida('00000000-0000-0000-0000-000000000000') as r")).rows[0].r, { ok: false });
  });
  test('un alumno no puede borrar partidas (ni la suya)', async () => {
    const r1 = await empezar('AAA222');
    await assert.rejects(anon('select public.profe_borrar_partida($1::uuid)', [r1.partida]), /permission denied/);
  });
});
