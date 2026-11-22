/* Pruebas de supabase/07_examen.sql (funciones del alumno) contra un Postgres REAL y LOCAL, en UTF8. Nunca toca Supabase.
   Se ejecuta con: npm run test:sql */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { SQL, iniciar, parar, baseNueva, conectar, como, comoUsuario } = require('./ayuda-sql');
const V = require('./vectores-correccion.json');

const RAIZ = path.join(__dirname, '..');
const PROFE = 'profe@ejemplo.test', OTRO = 'otro@ejemplo.test';
const A = 'AAA222', B = 'BBB333', OTRO_GRUPO = 'CCC444';        // TDA2-01, TDA2-02 y TDA1-01
const clon = o => JSON.parse(JSON.stringify(o));

const it = (id, extra) => ({ id, enun: 'Enunciado ' + id, sol: 'SOLUCION-' + id, trampa: 'TRAMPA-' + id, ...extra });
function bancoGrande() {
  const preguntas = [];
  ['t1', 't2', 't3'].forEach((tema, ti) => {
    preguntas.push(it(tema + 'mc', { tipo: 'opcion_multiple', ops: ['A ' + tema, 'B ' + tema, 'C ' + tema, 'D ' + tema], ok: 1, tema, salida: 'SALIDA-SECRETA', run_with: 'RW-SECRETO' }));
    preguntas.push(it(tema + 'fija', { tipo: 'opcion_multiple', ops: ['x1', 'x2', 'x3', 'Ninguna de las anteriores'], ok: 3, fija_ultima: true, tema }));
    preguntas.push(it(tema + 'vf', { tipo: 'verdadero_falso', ok: ti % 2 === 0, tema }));
    preguntas.push(ti % 2 === 0 ? it(tema + 'n', { tipo: 'numerica', valor: 9182736.5 + ti, tolerancia: 0.5, unidad: 'u', tema })
                                : it(tema + 'c', { tipo: 'respuesta_corta', aceptadas: ['canarioXYZ' + ti, 'otra' + ti], pista: 'una pista', tema }));
  });
  return { formato: 2, id: 'grande', titulo: 'Banco grande', materia: 'TDA I', preguntas };
}
const BANCO = bancoGrande();
const fuente = clave => BANCO.preguntas.find(p => p.id === clave.split('/')[1]);
const REGLAS = { preguntas: 6, tiempo_min: 20 };

let c, N, F;
test.before(async () => {
  await iniciar();
  N = await import(pathToFileURL(path.join(RAIZ, 'js', 'nucleo', 'preguntas', 'normalizar.js')).href);
  F = await import(pathToFileURL(path.join(RAIZ, 'js', 'nucleo', 'formato.js')).href);
  c = await baseNueva('examen', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '06_contenido.sql', '07_examen.sql']);
});
test.after(parar);

const profe = (sql, params) => comoUsuario(c, PROFE, sql, params);
let ASG;   // id de la asignación de cada prueba
async function montar({ reglas = REGLAS, intentos = 1, desde = null, hasta = null, mostrar = false } = {}) {
  await c.query('truncate eventos, respuestas, partidas, asignaciones, juegos, items, bancos, alumnos, grupos, profesores, accesos_fallidos cascade');
  await c.query('insert into profesores(email) values ($1)', [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II'), ('TDA1', 'TDA I')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA2-02', 'TDA2', public._hash_codigo('BBB333')), ('TDA1-01', 'TDA1', public._hash_codigo('CCC444'))");
  await profe('select public.profe_subir_banco($1::jsonb)', [JSON.stringify(BANCO)]);
  await profe('select public.profe_crear_juego($1::jsonb)', [JSON.stringify({ id: 'ex', modo: 'examen', titulo: 'Examen de prueba', bancos: ['grande'], reglas })]);
  ASG = (await profe('select public.profe_asignar($1, $2, $3, $4, $5, $6) as r', ['ex', 'TDA2', desde, hasta, intentos, mostrar])).rows[0].r.asignacion;
}
test.beforeEach(() => montar());

const anon = (sql, p) => como(c, 'anon', sql, p);
const mis = async cod => (await anon('select public.mis_juegos($1) as r', [cod])).rows[0].r;
const empezar = async (cod, asg = ASG) => (await anon('select public.empezar_partida($1, $2::bigint) as r', [cod, asg])).rows[0].r;
const responder = async (cod, p, item, dada, ms = null) => (await anon('select public.responder($1, $2::uuid, $3, $4::jsonb, $5::int) as r', [cod, p, item, JSON.stringify(dada), ms])).rows[0].r;
const evento = async (cod, p, tipo, detalle = null) => (await anon('select public.evento($1, $2::uuid, $3, $4::jsonb) as r', [cod, p, tipo, detalle === null ? null : JSON.stringify(detalle)])).rows[0].r;
const terminar = async (cod, p) => (await anon('select public.terminar_partida($1, $2::uuid) as r', [cod, p])).rows[0].r;
const resultado = async (cod, p) => (await anon('select public.mi_resultado($1, $2::uuid) as r', [cod, p])).rows[0].r;
const n = async (sql, p) => (await c.query(sql, p)).rows[0].n;

// Lo que habría que contestar para acertar, calculado a partir del banco original y de lo que VIO el alumno
function acierta(item) {
  const f = fuente(item.clave);
  if (f.tipo === 'opcion_multiple') return item.ops.indexOf(f.ops[f.ok]);
  if (f.tipo === 'verdadero_falso') return f.ok;
  if (f.tipo === 'numerica') return String(f.valor);
  return f.aceptadas[0];
}
function falla(item) {
  const f = fuente(item.clave);
  if (f.tipo === 'opcion_multiple') return item.ops.indexOf(f.ops[(f.ok + 1) % f.ops.length]);
  if (f.tipo === 'verdadero_falso') return !f.ok;
  return 'respuesta equivocada';
}
const contestar = (cod, r, fn, cuantas = r.items.length) => Promise.all(r.items.slice(0, cuantas).map(i => responder(cod, r.partida, i.clave, fn(i))));
const reiniciar = () => c.query('truncate eventos, respuestas, partidas cascade');

test.describe('corrección en SQL = corrección en JavaScript (mismos casos, misma respuesta)', () => {
  test('normalizar texto: los 14 casos compartidos', async () => {
    for (const [entrada, esperado] of V.normalizarTexto) assert.equal((await c.query('select public._normalizar_texto($1) as t', [entrada])).rows[0].t, esperado, JSON.stringify(entrada));
  });
  test('parsear número: los 20 casos compartidos', async () => {
    for (const [entrada, esperado] of V.parsearNumero) {
      const r = (await c.query('select public._parsear_numero($1) as t', [entrada])).rows[0].t;
      assert.equal(r === null ? null : Number(r), esperado, JSON.stringify(entrada));
    }
  });
  test('corregir: los 23 casos compartidos', async () => {
    for (const k of V.corregir) assert.equal((await c.query('select public._corregir_item($1::jsonb, $2::jsonb) as t', [JSON.stringify(k.p), JSON.stringify(k.dada)])).rows[0].t, k.ok, JSON.stringify(k));
  });
  test('TODAS las letras de Unicode con marca o mayúscula (latín, griego, cirílico, armenio y ancho completo: unos 3.800 caracteres) normalizan igual en SQL y en JS', async () => {
    const cadenas = [];
    for (const [ini, fin] of [[0x20, 0x24F], [0x370, 0x52F], [0x531, 0x556], [0x1E00, 0x1FFF], [0xFF21, 0xFF5A]])
      for (let cp = ini; cp <= fin; cp++) { if (cp >= 0x7F && cp <= 0x9F) continue; cadenas.push(String.fromCodePoint(cp)); }
    for (const ch of '                 　﻿\t\n\r\f\v') cadenas.push(ch);
    const todas = cadenas.flatMap(s => [s, 'a' + s + 'b', '  ' + s + ' x ' + s + '  ']);
    const r = (await c.query('select s, public._normalizar_texto(s) as t from unnest($1::text[]) as s', [todas])).rows;
    assert.equal(r.length, todas.length);
    const mal = r.filter(x => x.t !== N.normalizarTexto(x.s));
    assert.deepEqual(mal.slice(0, 5).map(x => [JSON.stringify(x.s), x.t, N.normalizarTexto(x.s)]), [], 'difieren ' + mal.length + ' de ' + todas.length);
  });
  test('500 cadenas al azar (acentos, signos, espacios, números): mismo texto y mismo número', async () => {
    let semilla = 20261120;
    const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alfabeto = ['a', 'A', 'e', 'É', 'ñ', 'Ñ', 'ü', 'ç', 'Ö', ' ', '  ', '\t', ' ', '.', ',', ';', ':', '!', '?', '¡', '¿', '"', "'", '«', '»', '“', '”', '(', ')', '[', ']', '-', '+', '−', '0', '1', '5', '9', 'x', 'ß', 'ø', 'ł', '€', '²'];
    const cadenas = Array.from({ length: 500 }, () => Array.from({ length: Math.floor(azar() * 12) }, () => alfabeto[Math.floor(azar() * alfabeto.length)]).join(''));
    const r = (await c.query('select s, public._normalizar_texto(s) as t, public._parsear_numero(s) as n from unnest($1::text[]) as s', [cadenas])).rows;
    for (const x of r) {
      assert.equal(x.t, N.normalizarTexto(x.s), 'texto de ' + JSON.stringify(x.s));
      const js = N.parsearNumero(x.s);
      assert.equal(x.n === null ? null : Number(x.n), js, 'número de ' + JSON.stringify(x.s));
    }
  });
});

test.describe('permisos', () => {
  test('la web pública puede llamar a las funciones del alumno, pero no a las internas ni a las del profesor', async () => {
    for (const sql of ["select public._corregir_item('{}'::jsonb, '1'::jsonb)", "select public._normalizar_texto('x')", "select public._cerrar_caducadas(null)",
      "select public._cerrar_partida(gen_random_uuid(), 'caducada')", "select public._salida_partida(gen_random_uuid())", "select public._barajar_opciones('{\"ops\":[1,2]}'::jsonb)",
      "select public._item_alumno('{}'::jsonb, null, 'x')", "select public.profe_cerrar_caducadas()"])
      await assert.rejects(anon(sql), /permission denied/, sql);
    await assert.rejects(comoUsuario(c, OTRO, 'select public.profe_cerrar_caducadas()'), /no_autorizado/);
    assert.equal((await mis(A)).ok, true);
  });
  test('las tablas siguen cerradas: partidas, respuestas y eventos no se leen desde la web', async () => {
    const r = await empezar(A); await responder(A, r.partida, r.items[0].clave, acierta(r.items[0]));
    for (const t of ['partidas', 'respuestas', 'eventos', 'items']) await assert.rejects(anon('select * from public.' + t), /permission denied/, t);
  });
  test('07 se puede ejecutar dos veces seguidas', async () => { await c.query(SQL('07_examen.sql')); await c.query(SQL('07_examen.sql')); });
});

test.describe('mis_juegos', () => {
  test('código que no existe → codigo; demasiados fallos → espera', async () => {
    assert.deepEqual(await mis('ZZZ999'), { ok: false, motivo: 'codigo' });
    for (let i = 0; i < 41; i++) await mis('ZZZ99' + (i % 10));
    assert.deepEqual(await mis(A), { ok: false, motivo: 'espera' });
  });
  test('el alumno ve lo asignado a SU grupo; otro grupo no ve nada', async () => {
    const r = await mis(A);
    assert.equal(r.juegos.length, 1);
    assert.deepEqual({ ...r.juegos[0], desde: null, hasta: null }, { asignacion: ASG, juego: 'ex', titulo: 'Examen de prueba', modo: 'examen', preguntas: 6, tiempo_min: 20, desde: null, hasta: null,
      intentos: 1, estado: 'abierto', hechos: 0, en_curso: null, notas_publicadas: false, partidas: [] });
    assert.deepEqual((await mis(OTRO_GRUPO)).juegos, []);
  });
  test('estado según las fechas: pronto, abierto, cerrado', async () => {
    await c.query("update asignaciones set desde = now() + interval '1 hour'"); assert.equal((await mis(A)).juegos[0].estado, 'pronto');
    await c.query("update asignaciones set desde = now() - interval '1 hour', hasta = now() + interval '1 hour'"); assert.equal((await mis(A)).juegos[0].estado, 'abierto');
    await c.query("update asignaciones set hasta = now() - interval '1 minute'"); assert.equal((await mis(A)).juegos[0].estado, 'cerrado');
  });
  test('refleja la partida en curso y los intentos hechos', async () => {
    const r = await empezar(A);
    let j = (await mis(A)).juegos[0]; assert.equal(j.en_curso, r.partida); assert.equal(j.hechos, 0);
    await terminar(A, r.partida);
    j = (await mis(A)).juegos[0]; assert.equal(j.en_curso, null); assert.equal(j.hechos, 1); assert.deepEqual(j.partidas.map(p => p.estado), ['entregada']);
  });
});

test.describe('empezar_partida', () => {
  test('devuelve las preguntas SIN ninguna solución (lista blanca de campos y ni rastro de lo secreto)', async () => {
    const r = await empezar(A);
    assert.equal(r.ok, true); assert.equal(r.total, 6); assert.equal(r.items.length, 6); assert.deepEqual(r.respondidas, {});
    assert.deepEqual(Object.keys(r).sort(), ['ahora', 'items', 'intento', 'limite', 'ok', 'partida', 'respondidas', 'restante_s', 'titulo', 'total'].sort());
    const permitidos = new Set(['clave', 'tipo', 'enun', 'code', 'act', 'categoria', 'pista', 'unidad', 'ops']);
    for (const i of r.items) for (const k of Object.keys(i)) assert.ok(permitidos.has(k), 'campo no permitido: ' + k);
    const texto = JSON.stringify(r);
    for (const secreto of ['SOLUCION-', 'TRAMPA-', 'SALIDA-SECRETA', 'RW-SECRETO', 'canarioXYZ', 'otra0', 'otra1', '9182736', 'seleccion', 'ops_orden'])
      assert.ok(!texto.includes(secreto), 'se ha colado «' + secreto + '» en lo que ve el alumno');
    for (const i of r.items.filter(x => x.tipo === 'opcion_multiple')) assert.deepEqual([...i.ops].sort(), [...fuente(i.clave).ops].sort());
    assert.equal(r.items.filter(x => x.tipo === 'respuesta_corta').every(x => x.pista === 'una pista'), true);
  });
  test('reparte por temas: con 6 preguntas y 3 temas, SIEMPRE 2 de cada uno (30 veces)', async () => {
    for (let k = 0; k < 30; k++) {
      await reiniciar(); const r = await empezar(A);
      const por = {}; r.items.forEach(i => { const t = fuente(i.clave).tema; por[t] = (por[t] || 0) + 1; });
      assert.deepEqual(por, { t1: 2, t2: 2, t3: 2 });
    }
  });
  test('con 7 y con 5 preguntas, cada tema aporta lo justo (reparto lo más parejo posible)', async () => {
    for (const [npreg, min, max] of [[7, 2, 3], [5, 1, 2], [4, 1, 2]]) {
      await montar({ reglas: { preguntas: npreg, tiempo_min: 20 } });
      for (let k = 0; k < 15; k++) {
        await reiniciar(); const r = await empezar(A);
        const por = { t1: 0, t2: 0, t3: 0 }; r.items.forEach(i => { por[fuente(i.clave).tema]++; });
        assert.equal(r.items.length, npreg);
        for (const v of Object.values(por)) assert.ok(v >= min && v <= max, npreg + ' preguntas → ' + JSON.stringify(por));
      }
    }
  });
  test('con equilibrar «ninguno» elige al azar, sin repartir (a veces sale desparejo)', async () => {
    await montar({ reglas: { preguntas: 6, tiempo_min: 20, equilibrar: 'ninguno' } });
    let desparejo = false;
    for (let k = 0; k < 40; k++) {
      await reiniciar(); const r = await empezar(A);
      assert.equal(r.items.length, 6);
      const por = { t1: 0, t2: 0, t3: 0 }; r.items.forEach(i => { por[fuente(i.clave).tema]++; });
      if (Object.values(por).some(v => v !== 2)) desparejo = true;
    }
    assert.ok(desparejo);
  });
  test('no repite preguntas y todas existen en el banco', async () => {
    const r = await empezar(A);
    assert.equal(new Set(r.items.map(i => i.clave)).size, 6);
    for (const i of r.items) assert.ok(fuente(i.clave));
  });
  test('baraja el orden de las preguntas y de las opciones; la «Ninguna de las anteriores» se queda al final', async () => {
    await montar({ reglas: { preguntas: 12, tiempo_min: 20 } });
    const primeras = new Set(), posiciones = new Set();
    for (let k = 0; k < 30; k++) {
      await reiniciar(); const r = await empezar(A);
      primeras.add(r.items[0].clave);
      const mc = r.items.find(i => i.clave === 'grande/t1mc'); posiciones.add(mc.ops.indexOf('B t1'));
      for (const i of r.items.filter(x => x.clave.endsWith('fija'))) assert.equal(i.ops[3], 'Ninguna de las anteriores');
    }
    assert.ok(primeras.size >= 4, 'el orden de preguntas casi no cambia: ' + primeras.size);
    assert.equal(posiciones.size, 4, 'la opción correcta debería aparecer en las 4 posiciones');
  });
  test('cada alumno recibe su propia selección y orden', async () => {
    const ra = await empezar(A), rb = await empezar(B);
    assert.notEqual(ra.partida, rb.partida);
    assert.notDeepEqual(ra.items.map(i => i.clave), rb.items.map(i => i.clave));
  });
  test('el límite de tiempo lo pone el servidor: ahora + 20 minutos', async () => {
    const r = await empezar(A);
    const min = (new Date(r.limite) - new Date(r.ahora)) / 60000;
    assert.ok(min > 19.9 && min <= 20.01, String(min));
    assert.ok(r.restante_s > 1190 && r.restante_s <= 1200);
  });
  test('si ya hay una en marcha la REANUDA: misma partida, mismas preguntas y lo ya contestado', async () => {
    const r = await empezar(A);
    await responder(A, r.partida, r.items[0].clave, acierta(r.items[0]));
    await responder(A, r.partida, r.items[1].clave, falla(r.items[1]));
    const otra = await empezar(A);
    assert.equal(otra.partida, r.partida);
    assert.deepEqual(otra.items, r.items);
    assert.deepEqual(Object.keys(otra.respondidas).sort(), [r.items[0].clave, r.items[1].clave].sort());
    assert.equal(otra.respondidas[r.items[0].clave], acierta(r.items[0]));      // lo que vio: la posición, también en opción múltiple
    assert.ok(otra.restante_s <= r.restante_s);
    assert.equal(await n('select count(*)::int n from partidas'), 1);
  });
  test('dos peticiones a la vez no crean dos partidas', async () => {
    const c1 = await conectar('examen'), c2 = await conectar('examen');
    const lanza = cx => cx.query("set role anon").then(() => cx.query('select public.empezar_partida($1, $2::bigint) as r', [A, ASG])).then(r => { cx.query('reset role'); return r.rows[0].r; });
    const [r1, r2] = await Promise.all([lanza(c1), lanza(c2)]);
    assert.equal(r1.partida, r2.partida);
    assert.equal(await n('select count(*)::int n from partidas'), 1);
  });
  test('un intento por defecto: tras entregar, sin_intentos; con 2 intentos, un segundo y luego sin_intentos', async () => {
    let r = await empezar(A); await terminar(A, r.partida);
    assert.deepEqual(await empezar(A), { ok: false, motivo: 'sin_intentos' });
    await montar({ intentos: 2 });
    r = await empezar(A); assert.equal(r.intento, 1); await terminar(A, r.partida);
    const r2 = await empezar(A); assert.equal(r2.intento, 2); assert.notEqual(r2.partida, r.partida); await terminar(A, r2.partida);
    assert.deepEqual(await empezar(A), { ok: false, motivo: 'sin_intentos' });
  });
  test('rechaza: código malo, otro grupo, asignación que no existe', async () => {
    assert.deepEqual(await empezar('ZZZ999'), { ok: false, motivo: 'codigo' });
    assert.deepEqual(await empezar(OTRO_GRUPO), { ok: false, motivo: 'no_encontrada' });
    assert.deepEqual(await empezar(A, 99999), { ok: false, motivo: 'no_encontrada' });
    assert.equal(await n('select count(*)::int n from partidas'), 0);
  });
  test('ventana: antes de «desde» aun_no, después de «hasta» cerrada; una en curso se puede seguir', async () => {
    await montar({ desde: new Date(Date.now() + 3600e3).toISOString(), hasta: new Date(Date.now() + 7200e3).toISOString() });
    assert.equal((await empezar(A)).motivo, 'aun_no');
    await montar({ desde: new Date(Date.now() - 7200e3).toISOString(), hasta: new Date(Date.now() + 3600e3).toISOString() });
    const r = await empezar(A); assert.equal(r.ok, true);
    await c.query("update asignaciones set hasta = now() - interval '1 minute'");
    assert.equal((await empezar(A)).partida, r.partida, 'la que estaba en curso se puede seguir');
    assert.equal((await empezar(B)).motivo, 'cerrada');
  });
});

test.describe('responder', () => {
  test('guarda y corrige EN EL SERVIDOR; la respuesta no dice si acertó', async () => {
    const r = await empezar(A);
    for (const i of r.items) { const x = await responder(A, r.partida, i.clave, acierta(i), 1500); assert.deepEqual(Object.keys(x).sort(), ['ok', 'restante_s']); assert.equal(x.ok, true); }
    assert.equal(await n('select count(*)::int n from respuestas where ok'), 6);
    assert.equal(await n('select count(*)::int n from respuestas where ms = 1500'), 6);
  });
  test('las respuestas equivocadas se marcan como fallo (cada tipo)', async () => {
    await montar({ reglas: { preguntas: 12, tiempo_min: 20 } });
    const r = await empezar(A); await contestar(A, r, falla);
    assert.equal(await n('select count(*)::int n from respuestas where not ok'), 12);
    assert.equal(new Set((await c.query("select split_part(item, '/', 2) i from respuestas")).rows.map(x => x.i)).size, 12);
  });
  test('opción múltiple: se contesta por POSICIÓN y se guarda la opción ORIGINAL', async () => {
    await montar({ reglas: { preguntas: 12, tiempo_min: 20 } });
    const r = await empezar(A);
    const i = r.items.find(x => x.clave === 'grande/t1mc');
    await responder(A, r.partida, i.clave, i.ops.indexOf('C t1'));          // la «C» (índice original 2), esté donde esté
    const g = (await c.query("select dada, ok from respuestas where item = 'grande/t1mc'")).rows[0];
    assert.deepEqual(g, { dada: 2, ok: false });
    await responder(A, r.partida, i.clave, i.ops.indexOf('B t1'));
    assert.deepEqual((await c.query("select dada, ok from respuestas where item = 'grande/t1mc'")).rows[0], { dada: 1, ok: true });
  });
  test('se puede cambiar la respuesta hasta entregar (una sola fila por pregunta)', async () => {
    const r = await empezar(A), i = r.items[0];
    await responder(A, r.partida, i.clave, falla(i)); await responder(A, r.partida, i.clave, acierta(i));
    assert.equal(await n('select count(*)::int n from respuestas'), 1);
    assert.equal(await n('select ok::int n from respuestas'), 1);
  });
  test('texto y número: acentos, mayúsculas, coma decimal y tolerancia, como en el navegador', async () => {
    await montar({ reglas: { preguntas: 12, tiempo_min: 20 } });
    const r = await empezar(A);
    await responder(A, r.partida, 'grande/t2c', '  CANÁRIOXYZ1. ');
    await responder(A, r.partida, 'grande/t1n', '9182736,9');
    await responder(A, r.partida, 'grande/t3n', '9182740');
    const ok = Object.fromEntries((await c.query('select item, ok from respuestas')).rows.map(x => [x.item, x.ok]));
    assert.deepEqual(ok, { 'grande/t2c': true, 'grande/t1n': true, 'grande/t3n': false });
  });
  test('datos mal formados: no se guardan', async () => {
    await montar({ reglas: { preguntas: 12, tiempo_min: 20 } });
    const r = await empezar(A); const p = r.partida;
    for (const [item, dada] of [['grande/t1mc', 4], ['grande/t1mc', -1], ['grande/t1mc', 1.5], ['grande/t1mc', '1'], ['grande/t1vf', 'true'], ['grande/t1vf', 1],
      ['grande/t1n', 47], ['grande/t1n', null], ['grande/t2c', ['a']], ['grande/t2c', 'x'.repeat(201)]])
      assert.deepEqual(await responder(A, p, item, dada), { ok: false, motivo: 'dato' }, item + ' ' + JSON.stringify(dada));
    assert.deepEqual(await responder(A, p, 'grande/inventada', 1), { ok: false, motivo: 'item' });
    assert.equal(await n('select count(*)::int n from respuestas'), 0);
  });
  test('una pregunta que no está en TU examen no se puede contestar', async () => {
    const r = await empezar(A);
    const fuera = BANCO.preguntas.map(p => 'grande/' + p.id).find(k => !r.items.some(i => i.clave === k));
    assert.equal((await responder(A, r.partida, fuera, true)).motivo, 'item');
  });
  test('la partida de otro alumno es «no_encontrada»; código malo, codigo', async () => {
    const r = await empezar(A);
    assert.equal((await responder(B, r.partida, r.items[0].clave, true)).motivo, 'no_encontrada');
    assert.equal((await responder('ZZZ999', r.partida, r.items[0].clave, true)).motivo, 'codigo');
    assert.equal((await responder(A, '00000000-0000-0000-0000-000000000000', r.items[0].clave, true)).motivo, 'no_encontrada');
    assert.equal(await n('select count(*)::int n from respuestas'), 0);
  });
  test('después de entregar ya no se puede contestar', async () => {
    const r = await empezar(A); await terminar(A, r.partida);
    assert.deepEqual(await responder(A, r.partida, r.items[0].clave, acierta(r.items[0])), { ok: false, motivo: 'entregada' });
  });
  test('entregar justo al acabarse el tiempo queda como «caducada»; con margen, «entregada»', async () => {
    const r = await empezar(A);
    await c.query("update partidas set limite = now() + interval '30 seconds'");
    assert.equal((await terminar(A, r.partida)).estado, 'entregada');
    const r2 = await empezar(B);
    await c.query("update partidas set limite = now() - interval '200 milliseconds' where id = $1", [r2.partida]);
    assert.equal((await terminar(B, r2.partida)).estado, 'caducada');
  });
  test('fuera de tiempo no cuenta (con 3 s de cortesía), y la partida se cierra sola', async () => {
    const r = await empezar(A);
    await c.query("update partidas set limite = now() - interval '1 second'");
    assert.equal((await responder(A, r.partida, r.items[0].clave, acierta(r.items[0]))).ok, true, 'dentro de la cortesía');
    await c.query("update partidas set limite = now() - interval '10 seconds'");
    assert.deepEqual(await responder(A, r.partida, r.items[1].clave, acierta(r.items[1])), { ok: false, motivo: 'caducada' });
    assert.equal(await n('select count(*)::int n from respuestas'), 1);
    assert.equal((await c.query('select estado from partidas')).rows[0].estado, 'caducada');
  });
});

test.describe('evento', () => {
  test('anota salidas, vueltas y demás con su detalle', async () => {
    const r = await empezar(A);
    assert.deepEqual(await evento(A, r.partida, 'salida'), { ok: true, anotado: true });
    await evento(A, r.partida, 'vuelta', { segundos: 12 });
    const f = (await c.query('select tipo, detalle from eventos order by id')).rows;
    assert.deepEqual(f, [{ tipo: 'salida', detalle: null }, { tipo: 'vuelta', detalle: { segundos: 12 } }]);
  });
  test('tipo inventado, detalle gigante, otro alumno, y después de entregar', async () => {
    const r = await empezar(A);
    assert.equal((await evento(A, r.partida, 'trampa')).motivo, 'dato');
    await evento(A, r.partida, 'otro', { x: 'y'.repeat(600) });
    assert.equal((await c.query('select detalle from eventos')).rows[0].detalle, null);
    assert.equal((await evento(B, r.partida, 'salida')).motivo, 'no_encontrada');
    await terminar(A, r.partida);
    assert.equal((await evento(A, r.partida, 'salida')).motivo, 'entregada');
  });
  test('un máximo de 500 por partida (no se puede inundar la tabla)', async () => {
    const r = await empezar(A);
    await c.query("insert into eventos(partida, tipo) select $1::uuid, 'salida' from generate_series(1, 500)", [r.partida]);
    assert.deepEqual(await evento(A, r.partida, 'salida'), { ok: true, anotado: false });
    assert.equal(await n('select count(*)::int n from eventos'), 500);
  });
});

test.describe('terminar_partida y la nota', () => {
  const nota = async () => Number((await c.query('select nota from partidas')).rows[0].nota);
  test('todo bien → 10; la respuesta de terminar NO trae la nota', async () => {
    const r = await empezar(A); await contestar(A, r, acierta);
    const t = await terminar(A, r.partida);
    assert.deepEqual(t, { ok: true, estado: 'entregada', publicada: false });
    assert.equal(await nota(), 10);
    const f = (await c.query('select aciertos, total, estado, terminada is not null as t from partidas')).rows[0];
    assert.deepEqual(f, { aciertos: 6, total: 6, estado: 'entregada', t: true });
  });
  test('la mitad bien → 5; lo que no se contesta cuenta como fallo; nada contestado → 0', async () => {
    let r = await empezar(A); await contestar(A, r, acierta, 3); await terminar(A, r.partida); assert.equal(await nota(), 5);
    await montar(); r = await empezar(A); await terminar(A, r.partida); assert.equal(await nota(), 0);
  });
  test('con penalización 0,25: (3 − 0,25×2)/6×10 = 4,17 y nunca baja de 0', async () => {
    await montar({ reglas: { preguntas: 6, tiempo_min: 20, penalizacion: 0.25 } });
    let r = await empezar(A);
    await contestar(A, r, acierta, 3);
    await Promise.all(r.items.slice(3, 5).map(i => responder(A, r.partida, i.clave, falla(i))));    // 2 fallos, 1 en blanco
    await terminar(A, r.partida); assert.equal(await nota(), 4.17);
    await montar({ reglas: { preguntas: 6, tiempo_min: 20, penalizacion: 1 } });
    r = await empezar(A); await contestar(A, r, falla); await terminar(A, r.partida); assert.equal(await nota(), 0);
  });
  test('entregar dos veces da lo mismo y no cambia la nota', async () => {
    const r = await empezar(A); await contestar(A, r, acierta, 2);
    const t1 = await terminar(A, r.partida), nota1 = await nota(), term1 = (await c.query('select terminada from partidas')).rows[0].terminada;
    const t2 = await terminar(A, r.partida);
    assert.deepEqual(t2, t1); assert.equal(await nota(), nota1);
    assert.deepEqual((await c.query('select terminada from partidas')).rows[0].terminada, term1);
  });
  test('entregar fuera de tiempo la deja como «caducada», con lo contestado a tiempo', async () => {
    const r = await empezar(A); await contestar(A, r, acierta, 4);
    await c.query("update partidas set limite = now() - interval '1 minute'");
    assert.equal((await terminar(A, r.partida)).estado, 'caducada');
    assert.equal(await nota(), 6.67);
  });
  test('otro alumno no puede entregar tu examen', async () => {
    const r = await empezar(A);
    assert.equal((await terminar(B, r.partida)).motivo, 'no_encontrada');
    assert.equal((await c.query('select estado from partidas')).rows[0].estado, 'en_curso');
  });
});

test.describe('la nota está OCULTA hasta que el profesor la publica', () => {
  async function entregada(buenas = 3, opciones) {
    if (opciones) await montar(opciones);
    const r = await empezar(A); await contestar(A, r, acierta, buenas); await terminar(A, r.partida); return r.partida;
  }
  test('antes de publicar: solo el estado, nada de nota, aciertos ni total; ni en mis_juegos', async () => {
    const p = await entregada();
    const r = await resultado(A, p);
    assert.deepEqual(Object.keys(r).sort(), ['estado', 'ok', 'publicada', 'terminada']);
    assert.equal(r.publicada, false);
    assert.equal(JSON.stringify(r).includes('nota'), false);
    const j = (await mis(A)).juegos[0];
    assert.deepEqual(Object.keys(j.partidas[0]).sort(), ['estado', 'id', 'intento']);
  });
  test('publicadas: nota, aciertos y total; y puede volver a ocultarse', async () => {
    const p = await entregada();
    await profe('select public.profe_publicar_notas($1::bigint, true)', [ASG]);
    const r = await resultado(A, p);
    assert.deepEqual({ nota: Number(r.nota), aciertos: r.aciertos, total: r.total, publicada: r.publicada }, { nota: 5, aciertos: 3, total: 6, publicada: true });
    assert.equal(r.revision, undefined, 'sin soluciones si la asignación no lo permite');
    assert.equal(Number((await mis(A)).juegos[0].partidas[0].nota), 5);
    await profe('select public.profe_publicar_notas($1::bigint, false)', [ASG]);
    assert.equal((await resultado(A, p)).nota, undefined);
  });
  test('con «mostrar soluciones» y publicadas: la revisión, pregunta a pregunta, con su por qué', async () => {
    const p = await entregada(3, { mostrar: true });
    await profe('select public.profe_publicar_notas($1::bigint, true)', [ASG]);
    const r = await resultado(A, p);
    assert.equal(r.revision.length, 6);
    assert.equal(r.revision.filter(x => x.ok).length, 3);
    assert.equal(r.revision.filter(x => x.respondida).length, 3);
    for (const x of r.revision) { assert.ok(x.sol.startsWith('SOLUCION-')); assert.ok(x.trampa.startsWith('TRAMPA-')); assert.notEqual(x.correcta, undefined); }
  });
  test('una partida en curso nunca enseña nota, aunque esté publicada la asignación; y no se ve la de otro', async () => {
    await profe('select public.profe_publicar_notas($1::bigint, true)', [ASG]);
    const r = await empezar(A); await contestar(A, r, acierta);
    const x = await resultado(A, r.partida);
    assert.equal(x.estado, 'en_curso'); assert.equal(x.nota, undefined); assert.ok(x.restante_s > 0);
    assert.equal((await resultado(B, r.partida)).motivo, 'no_encontrada');
    assert.equal((await resultado('ZZZ999', r.partida)).motivo, 'codigo');
  });
});

test.describe('partidas abandonadas: se cierran solas cuando caduca el tiempo', () => {
  test('al pedir sus juegos, la caducada se cierra con lo contestado a tiempo', async () => {
    const r = await empezar(A); await contestar(A, r, acierta, 2);
    await c.query("update partidas set limite = now() - interval '10 minutes'");
    const j = (await mis(A)).juegos[0];
    assert.equal(j.en_curso, null); assert.equal(j.hechos, 1); assert.equal(j.partidas[0].estado, 'caducada');
    const f = (await c.query('select estado, nota, aciertos, total, terminada = limite as t from partidas')).rows[0];
    assert.deepEqual({ ...f, nota: Number(f.nota) }, { estado: 'caducada', nota: 3.33, aciertos: 2, total: 6, t: true });
    assert.equal((await empezar(A)).motivo, 'sin_intentos');
  });
  test('mi_resultado también la cierra', async () => {
    const r = await empezar(A);
    await c.query("update partidas set limite = now() - interval '10 minutes'");
    assert.equal((await resultado(A, r.partida)).estado, 'caducada');
  });
  test('el profesor las barre todas de golpe', async () => {
    const ra = await empezar(A), rb = await empezar(B);
    await c.query("update partidas set limite = now() - interval '10 minutes' where id = $1", [ra.partida]);
    const x = (await profe('select public.profe_cerrar_caducadas() as r')).rows[0].r;
    assert.deepEqual(x, { ok: true, cerradas: 1 });
    assert.deepEqual((await c.query('select id, estado from partidas order by estado')).rows.map(p => p.estado), ['caducada', 'en_curso']);
    assert.equal((await profe('select public.profe_cerrar_caducadas() as r')).rows[0].r.cerradas, 0);
  });
});
