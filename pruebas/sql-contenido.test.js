/* Pruebas de supabase/06_contenido.sql contra un Postgres REAL y LOCAL (nunca Supabase).
   Se ejecuta con: npm run test:sql   (ayuda común: pruebas/ayuda-sql.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { SQL, iniciar, parar, baseNueva, como, comoUsuario } = require('./ayuda-sql');

const PROFE = 'profe@ejemplo.test', OTRO = 'otro@ejemplo.test';
const RAIZ = path.join(__dirname, '..');
const leerTest = id => JSON.parse(require('fs').readFileSync(path.join(RAIZ, 'tests', id + '.json'), 'utf8'));
const clon = o => JSON.parse(JSON.stringify(o));
const it = (id, extra) => ({ id, enun: 'Enunciado ' + id, sol: 'Porque sí', trampa: 'Cuidado', ...extra });
const MIXTO = { formato: 2, id: 'mixto', titulo: 'Banco mixto', materia: 'TDA I', unidad: 'U1', preguntas: [
  it('a', { tipo: 'opcion_multiple', ops: ['1', '2', '3', '4'], ok: 1, tema: 't1', dificultad: 2, criterio: '2.1' }),
  it('b', { tipo: 'verdadero_falso', ok: true, tema: 't1' }),
  it('c', { tipo: 'numerica', valor: 47, tolerancia: 0.5, unidad: 'dec', tema: 't2' }),
  it('d', { tipo: 'respuesta_corta', aceptadas: ['ram', 'memoria ram'], tema: 't2' }) ] };

let c, F;
test.before(async () => {
  await iniciar();
  F = await import(pathToFileURL(path.join(RAIZ, 'js', 'nucleo', 'formato.js')).href);
  c = await baseNueva('contenido', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '06_contenido.sql']);
});
test.after(parar);
test.beforeEach(async () => {
  await c.query('truncate eventos, respuestas, partidas, asignaciones, juegos, items, bancos, alumnos, grupos, profesores cascade');
  await c.query("insert into profesores(email) values ($1)", [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II'), ('TDA1', 'TDA I')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA2-02', 'TDA2', public._hash_codigo('BBB333'))");
});

const profe = (sql, params) => comoUsuario(c, PROFE, sql, params);
const subir = async banco => (await profe('select public.profe_subir_banco($1::jsonb) as r', [JSON.stringify(banco)])).rows[0].r;
const juego = async j => (await profe('select public.profe_crear_juego($1::jsonb) as r', [JSON.stringify(j)])).rows[0].r;
const asignar = async (...a) => (await profe('select public.profe_asignar($1, $2, $3, $4, $5, $6) as r', a)).rows[0].r;
const n = async sql => (await c.query(sql)).rows[0].n;
const JUEGO = { id: 'examen1', modo: 'examen', titulo: 'Examen 1', bancos: ['mixto'], reglas: { preguntas: 3, tiempo_min: 20 } };
const empezarPartida = () => c.query("insert into partidas(alumno, asignacion, intento) select 'TDA2-01', id, 1 from asignaciones limit 1");

test.describe('06 se instala bien', () => {
  test('se puede ejecutar dos veces seguidas', async () => { await c.query(SQL('06_contenido.sql')); await c.query(SQL('06_contenido.sql')); });
  test('lo que ya existía sigue igual: intentos, guardar_intento y entrar', async () => {
    const r = await como(c, 'anon', "select public.entrar('AAA-222') as r");
    assert.equal(r.rows[0].r.ok, true);
    const g = await como(c, 'anon', 'select public.guardar_intento($1, $2::jsonb) as r', ['AAA222', JSON.stringify({ test: 'x', version: 1, total: 1, aciertos: 1, nota: 10, respuestas: [{ id: 'q1', elegida: 0, ok: true, ms: 1 }] })]);
    assert.deepEqual(g.rows[0].r, { ok: true });
  });
});

test.describe('seguridad: la web pública no ve ni toca nada', () => {
  const TABLAS = ['bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos'];
  const CAMBIO = { bancos: 'titulo = titulo', items: 'orden = orden', juegos: 'titulo = titulo', asignaciones: 'intentos = intentos', partidas: 'estado = estado', respuestas: 'ok = ok', eventos: 'tipo = tipo' };
  test('anon: permiso denegado para leer, escribir, cambiar y borrar', async () => {
    await subir(MIXTO);
    for (const t of TABLAS) for (const sql of ['select * from public.' + t, 'delete from public.' + t, 'update public.' + t + ' set ' + CAMBIO[t]])
      await assert.rejects(como(c, 'anon', sql), /permission denied/, t + ': ' + sql);
  });
  test('una sesión que NO es profesor no ve ninguna fila y no puede escribir', async () => {
    await subir(MIXTO);
    for (const t of TABLAS) {
      assert.equal((await comoUsuario(c, OTRO, 'select count(*)::int n from public.' + t)).rows[0].n, 0, t);
      await assert.rejects(comoUsuario(c, OTRO, 'delete from public.' + t), /permission denied/, t);
    }
  });
  test('el profesor LEE todo pero no puede escribir directamente en las tablas', async () => {
    await subir(MIXTO);
    assert.equal((await profe('select count(*)::int n from public.items')).rows[0].n, 4);
    assert.equal((await profe("select datos ->> 'sol' as s from public.items where id = 'a'")).rows[0].s, 'Porque sí');
    for (const t of TABLAS) {
      await assert.rejects(profe('delete from public.' + t), /permission denied/, t);
      await assert.rejects(profe('update public.' + t + ' set ' + CAMBIO[t]), /permission denied/, t);
    }
    await assert.rejects(profe("insert into public.bancos(id, titulo) values ('x', 'x')"), /permission denied/);
  });
  test('las funciones profe_*: anon sin permiso; una sesión que no es profesor, no_autorizado', async () => {
    const llamadas = ["select public.profe_subir_banco('{}'::jsonb)", "select public.profe_borrar_banco('x')", "select public.profe_crear_juego('{}'::jsonb)",
      "select public.profe_asignar('x', 'TDA2')", "select public.profe_publicar_notas(1)", "select public.profe_borrar_asignacion(1)"];
    for (const sql of llamadas) {
      await assert.rejects(como(c, 'anon', sql), /permission denied/, sql);
      await assert.rejects(comoUsuario(c, OTRO, sql), /no_autorizado/, sql);
    }
    assert.equal(await n('select count(*)::int n from bancos'), 0);
  });
  test('la validación interna no se puede llamar desde fuera', async () => {
    await assert.rejects(como(c, 'anon', "select public._validar_item('{}'::jsonb)"), /permission denied/);
    await assert.rejects(comoUsuario(c, PROFE, "select public._validar_item('{}'::jsonb)"), /permission denied/);
  });
});

test.describe('profe_subir_banco', () => {
  test('sube un banco con los 4 tipos y guarda tema, dificultad y criterio aparte', async () => {
    assert.deepEqual(await subir(MIXTO), { ok: true, banco: 'mixto', version: 1, items: 4 });
    const f = (await c.query('select id, orden, tipo, tema, dificultad, criterio from items order by orden')).rows;
    assert.deepEqual(f.map(x => x.id), ['a', 'b', 'c', 'd']);
    assert.deepEqual(f.map(x => x.tipo), ['opcion_multiple', 'verdadero_falso', 'numerica', 'respuesta_corta']);
    assert.deepEqual(f[0], { id: 'a', orden: 0, tipo: 'opcion_multiple', tema: 't1', dificultad: 2, criterio: '2.1' });
    assert.equal((await c.query("select titulo, materia, unidad from bancos where id = 'mixto'")).rows[0].materia, 'TDA I');
  });
  test('volver a subirlo REEMPLAZA las preguntas y sube la versión', async () => {
    await subir(MIXTO);
    const menos = clon(MIXTO); menos.preguntas = menos.preguntas.slice(0, 2); menos.titulo = 'Nuevo título';
    assert.deepEqual(await subir(menos), { ok: true, banco: 'mixto', version: 2, items: 2 });
    assert.equal(await n('select count(*)::int n from items'), 2);
    assert.equal((await c.query("select titulo, version from bancos")).rows[0].titulo, 'Nuevo título');
  });
  test('las preguntas se guardan completas, con su solución', async () => {
    await subir(MIXTO);
    const d = (await c.query("select datos from items where id = 'd'")).rows[0].datos;
    assert.deepEqual(d, MIXTO.preguntas[3]);
  });

  const INVALIDOS = [
    ['formato 1', b => { delete b.formato; }, 'formato: 2'],
    ['id de banco raro', b => { b.id = '../x'; }, 'id no válido'],
    ['id de banco con mayúsculas', b => { b.id = 'Mixto'; }, 'id no válido'],
    ['sin título', b => { delete b.titulo; }, 'falta el título'],
    ['sin preguntas', b => { b.preguntas = []; }, 'no hay preguntas'],
    ['id de pregunta repetido', b => { b.preguntas[1].id = 'a'; }, 'repetidos'],
    ['id de pregunta raro', b => { b.preguntas[0].id = 'a b'; }, 'id no válido'],
    ['sin enunciado', b => { delete b.preguntas[0].enun; }, 'enun'],
    ['sin «sol»', b => { delete b.preguntas[0].sol; }, 'sol'],
    ['sin «trampa»', b => { b.preguntas[0].trampa = '  '; }, 'trampa'],
    ['tipo que no se juega', b => { b.preguntas[0].tipo = 'ordenar'; }, 'desconocido'],
    ['tipo inventado', b => { b.preguntas[0].tipo = 'adivinanza'; }, 'desconocido'],
    ['«ok» fuera de rango', b => { b.preguntas[0].ok = 4; }, 'ok debe ser'],
    ['«ok» no entero', b => { b.preguntas[0].ok = 1.5; }, 'ok debe ser'],
    ['«ok» como texto', b => { b.preguntas[0].ok = '1'; }, 'ok debe ser'],
    ['una sola opción', b => { b.preguntas[0].ops = ['x']; }, '2 a 6'],
    ['demasiadas opciones', b => { b.preguntas[0].ops = ['1', '2', '3', '4', '5', '6', '7']; }, '2 a 6'],
    ['verdadero_falso con «ok» de texto', b => { b.preguntas[1].ok = 'si'; }, 'true o false'],
    ['numerica sin valor', b => { delete b.preguntas[2].valor; }, 'valor'],
    ['numerica con valor de texto', b => { b.preguntas[2].valor = '47'; }, 'valor'],
    ['tolerancia negativa', b => { b.preguntas[2].tolerancia = -1; }, 'tolerancia'],
    ['unidad vacía', b => { b.preguntas[2].unidad = ''; }, 'unidad'],
    ['respuesta_corta sin aceptadas', b => { b.preguntas[3].aceptadas = []; }, 'aceptadas'],
    ['aceptada vacía', b => { b.preguntas[3].aceptadas = ['ram', ' ']; }, 'aceptada'],
    ['demasiadas aceptadas', b => { b.preguntas[3].aceptadas = Array.from({ length: 21 }, (_, i) => 'r' + i); }, 'aceptadas'],
    ['dificultad 5', b => { b.preguntas[0].dificultad = 5; }, 'dificultad'],
    ['criterio numérico', b => { b.preguntas[0].criterio = 21; }, 'criterio'],
    ['tema vacío', b => { b.preguntas[0].tema = ''; }, 'tema']
  ];
  for (const [nombre, cambia, motivo] of INVALIDOS) {
    test('rechaza: ' + nombre + ' (y no cambia nada)', async () => {
      await subir(MIXTO);
      const b = clon(MIXTO); cambia(b);
      await assert.rejects(subir(b), new RegExp('(banco_no_valido|item_no_valido).*' + motivo.replace(/[«»]/g, '.')), nombre);
      assert.equal(await n('select count(*)::int n from items'), 4, 'las preguntas siguen como estaban');
      assert.equal(await n('select version::int n from bancos'), 1, 'la versión no sube');
    });
  }
  test('el JS y el SQL aceptan y rechazan LO MISMO', async () => {
    assert.deepEqual(F.validarBanco(MIXTO), []);
    for (const [nombre, cambia] of INVALIDOS) {
      const b = clon(MIXTO); cambia(b);
      assert.ok(F.validarBanco(b).length > 0, 'el validador de JS debería rechazar: ' + nombre);
    }
    // y algunas variantes válidas que ambos aceptan
    const validas = [b => { b.preguntas[0].ops = ['1', '2']; b.preguntas[0].ok = 0; }, b => { b.preguntas[2].tolerancia = 0; }, b => { delete b.preguntas[0].tema; },
      b => { b.preguntas[0].ok = 3; }, b => { b.preguntas[3].aceptadas = Array.from({ length: 20 }, (_, i) => 'r' + i); }, b => { b.preguntas[1].ok = false; }];
    for (const cambia of validas) { const b = clon(MIXTO); cambia(b); assert.deepEqual(F.validarBanco(b), [], 'JS'); await subir(b); }
  });
  test('los 2 tests reales (80 preguntas), pasados a formato 2, los acepta el SQL', async () => {
    for (const id of ['tda2-u1-python-practica', 'tda1-u1u2-repaso']) {
      const b = F.aFormato2(leerTest(id));
      assert.deepEqual(F.validarBanco(b), []);
      assert.equal((await subir(b)).items, 40);
    }
    assert.equal(await n('select count(*)::int n from items'), 80);
  });
  test('demasiadas preguntas o banco gigante', async () => {
    const b = clon(MIXTO); b.preguntas = Array.from({ length: 501 }, (_, i) => it('p' + i, { tipo: 'verdadero_falso', ok: true }));
    await assert.rejects(subir(b), /demasiadas preguntas/);
  });
});

test.describe('banco en uso', () => {
  test('un banco usado por un juego se puede cambiar mientras no haya partidas, y se puede borrar solo si ningún juego lo usa', async () => {
    await subir(MIXTO); await juego(JUEGO);
    await assert.rejects(profe("select public.profe_borrar_banco('mixto')"), /banco_en_uso/);
    assert.equal((await subir(MIXTO)).version, 2);
    await profe("select public.profe_borrar_banco('xx')");
  });
  test('con partidas hechas, NO se reemplaza el banco ni se cambia el juego', async () => {
    await subir(MIXTO); await juego(JUEGO); await asignar('examen1', 'TDA2', null, null, 1, false); await empezarPartida();
    await assert.rejects(subir(MIXTO), /banco_en_uso/);
    await assert.rejects(juego({ ...JUEGO, titulo: 'Otro título' }), /juego_en_uso/);
    assert.equal(await n('select version::int n from bancos'), 1);
  });
  test('borrar un banco sin juegos borra también sus preguntas', async () => {
    await subir(MIXTO);
    assert.deepEqual((await profe("select public.profe_borrar_banco('mixto') as r")).rows[0].r, { ok: true });
    assert.equal(await n('select count(*)::int n from items'), 0);
    assert.deepEqual((await profe("select public.profe_borrar_banco('mixto') as r")).rows[0].r, { ok: false });
  });
});

test.describe('profe_crear_juego', () => {
  test.beforeEach(async () => { await subir(MIXTO); });
  test('crea un juego con las reglas completas (rellena los valores por defecto)', async () => {
    const r = await juego({ ...JUEGO, reglas: { preguntas: 3 } });
    assert.deepEqual(r.reglas, { preguntas: 3, tiempo_min: 30, penalizacion: 0, equilibrar: 'tema' });
    const f = (await c.query('select modo, bancos, reglas from juegos')).rows[0];
    assert.equal(f.modo, 'examen'); assert.deepEqual(f.bancos, ['mixto']);
  });
  test('sin reglas usa 20 preguntas (y falla si el banco tiene menos)', async () => {
    await assert.rejects(juego({ ...JUEGO, reglas: undefined }), /pide 20 preguntas y los bancos solo tienen 4/);
  });
  test('cambiar un juego sin partidas lo actualiza, no lo duplica', async () => {
    await juego(JUEGO); await juego({ ...JUEGO, titulo: 'Examen 1 (v2)', reglas: { preguntas: 2, tiempo_min: 45, penalizacion: 0.25, equilibrar: 'ninguno' } });
    const f = (await c.query('select titulo, reglas from juegos')).rows;
    assert.equal(f.length, 1); assert.equal(f[0].titulo, 'Examen 1 (v2)'); assert.equal(f[0].reglas.tiempo_min, 45);
  });
  const MAL = [
    ['modo que no existe', { modo: 'rosco' }, 'modo no válido'], ['id raro', { id: 'Examen 1' }, 'id no válido'], ['sin título', { titulo: '' }, 'falta el título'],
    ['sin bancos', { bancos: [] }, 'bancos debe ser'], ['banco que no existe', { bancos: ['nada'] }, 'algún banco no existe'], ['bancos de otro tipo', { bancos: [1] }, 'lista de textos'],
    ['reglas que no es objeto', { reglas: 5 }, 'reglas debe ser un objeto'], ['regla desconocida', { reglas: { preguntass: 3 } }, 'regla desconocida'],
    ['0 preguntas', { reglas: { preguntas: 0 } }, 'preguntas debe ser'], ['101 preguntas', { reglas: { preguntas: 101 } }, 'preguntas debe ser'], ['preguntas decimal', { reglas: { preguntas: 2.5 } }, 'preguntas debe ser'],
    ['0 minutos', { reglas: { tiempo_min: 0 } }, 'tiempo_min'], ['301 minutos', { reglas: { tiempo_min: 301 } }, 'tiempo_min'],
    ['penalización 2', { reglas: { penalizacion: 2 } }, 'penalizacion'], ['equilibrar raro', { reglas: { equilibrar: 'dificultad' } }, 'equilibrar'],
    ['más preguntas de las que hay', { reglas: { preguntas: 5 } }, 'pide 5 preguntas y los bancos solo tienen 4']
  ];
  for (const [nombre, cambio, motivo] of MAL) test('rechaza: ' + nombre, async () => {
    const j = { ...JUEGO, ...cambio };
    await assert.rejects(juego(j), new RegExp(motivo));
    assert.equal(await n('select count(*)::int n from juegos'), 0);
  });
  test('un juego con dos bancos suma sus preguntas', async () => {
    await subir({ ...MIXTO, id: 'otro', titulo: 'Otro' });
    await juego({ ...JUEGO, bancos: ['mixto', 'otro'], reglas: { preguntas: 8 } });
    assert.equal(await n('select cardinality(bancos)::int n from juegos'), 2);
  });
});

test.describe('profe_asignar y compañía', () => {
  test.beforeEach(async () => { await subir(MIXTO); await juego(JUEGO); });
  test('asigna un juego a un grupo con fechas e intentos', async () => {
    const r = await asignar('examen1', 'TDA2', '2026-11-25T08:00:00Z', '2026-11-25T10:00:00Z', 2, true);
    assert.equal(r.ok, true);
    const f = (await c.query('select grupo, intentos, mostrar_soluciones, notas_publicadas, desde, hasta from asignaciones')).rows[0];
    assert.equal(f.grupo, 'TDA2'); assert.equal(f.intentos, 2); assert.equal(f.mostrar_soluciones, true); assert.equal(f.notas_publicadas, false);
    assert.equal(f.hasta - f.desde, 2 * 3600 * 1000);
  });
  test('sin fechas vale (sin límite) y por defecto: 1 intento, sin soluciones', async () => {
    await asignar('examen1', 'TDA2', null, null, 1, false);
    const f = (await c.query('select desde, hasta, intentos, mostrar_soluciones from asignaciones')).rows[0];
    assert.deepEqual([f.desde, f.hasta, f.intentos, f.mostrar_soluciones], [null, null, 1, false]);
  });
  test('asignar otra vez al mismo grupo actualiza (no duplica) y no toca las notas publicadas', async () => {
    const a = (await asignar('examen1', 'TDA2', null, null, 1, false)).asignacion;
    await profe('select public.profe_publicar_notas($1::bigint, true)', [a]);
    await asignar('examen1', 'TDA2', null, null, 3, false);
    const f = (await c.query('select intentos, notas_publicadas from asignaciones')).rows;
    assert.equal(f.length, 1); assert.equal(f[0].intentos, 3); assert.equal(f[0].notas_publicadas, true);
  });
  test('rechaza: juego o grupo que no existen, intentos fuera de rango, fechas al revés', async () => {
    await assert.rejects(asignar('nada', 'TDA2', null, null, 1, false), /el juego no existe/);
    await assert.rejects(asignar('examen1', 'NADA', null, null, 1, false), /el grupo no existe/);
    await assert.rejects(asignar('examen1', 'TDA2', null, null, 0, false), /intentos/);
    await assert.rejects(asignar('examen1', 'TDA2', null, null, 11, false), /intentos/);
    await assert.rejects(asignar('examen1', 'TDA2', '2026-11-25T10:00:00Z', '2026-11-25T08:00:00Z', 1, false), /posterior/);
    await assert.rejects(asignar('examen1', 'TDA2', '2026-11-25T10:00:00Z', '2026-11-25T10:00:00Z', 1, false), /posterior/);
    assert.equal(await n('select count(*)::int n from asignaciones'), 0);
  });
  test('publicar y ocultar las notas; una asignación que no existe da ok:false', async () => {
    const a = (await asignar('examen1', 'TDA2', null, null, 1, false)).asignacion;
    assert.deepEqual((await profe('select public.profe_publicar_notas($1::bigint) as r', [a])).rows[0].r, { ok: true, notas_publicadas: true });
    assert.equal(await n('select notas_publicadas::int n from asignaciones'), 1);
    assert.deepEqual((await profe('select public.profe_publicar_notas($1::bigint, false) as r', [a])).rows[0].r, { ok: true, notas_publicadas: false });
    assert.equal((await profe('select public.profe_publicar_notas(9999) as r')).rows[0].r.ok, false);
  });
  test('borrar una asignación: se puede si nadie ha empezado; no si hay partidas', async () => {
    const a = (await asignar('examen1', 'TDA2', null, null, 1, false)).asignacion;
    await empezarPartida();
    await assert.rejects(profe('select public.profe_borrar_asignacion($1::bigint)', [a]), /asignacion_con_partidas/);
    await c.query('delete from partidas');
    assert.equal((await profe('select public.profe_borrar_asignacion($1::bigint) as r', [a])).rows[0].r.ok, true);
    assert.equal(await n('select count(*)::int n from asignaciones'), 0);
  });
});

test.describe('restricciones de las tablas de partidas', () => {
  test.beforeEach(async () => { await subir(MIXTO); await juego(JUEGO); await asignar('examen1', 'TDA2', null, null, 2, false); });
  test('un alumno no repite el mismo intento, y el estado y la nota tienen que ser válidos', async () => {
    await empezarPartida();
    await assert.rejects(empezarPartida(), /unique|duplicate/i);
    await c.query("insert into partidas(alumno, asignacion, intento) select 'TDA2-01', id, 2 from asignaciones");
    await assert.rejects(c.query("update partidas set estado = 'hecha'"), /check/i);
    await assert.rejects(c.query("update partidas set nota = 10.5"), /check/i);
    await assert.rejects(c.query("update partidas set nota = -1"), /check/i);
    await c.query("update partidas set estado = 'entregada', nota = 8.25, aciertos = 3, total = 4, terminada = now() where intento = 1");
  });
  test('respuestas y eventos cuelgan de la partida y se borran con ella', async () => {
    await empezarPartida();
    const pid = (await c.query('select id from partidas')).rows[0].id;
    await c.query("insert into respuestas(partida, item, dada, ok, ms) values ($1, 'a', '1', true, 1200)", [pid]);
    await assert.rejects(c.query("insert into respuestas(partida, item, dada, ok) values ($1, 'a', '2', false)", [pid]), /unique|duplicate/i);
    await c.query("insert into eventos(partida, tipo) values ($1, 'salida'), ($1, 'vuelta')", [pid]);
    await assert.rejects(c.query("insert into eventos(partida, tipo) values ($1, 'trampa')", [pid]), /check/i);
    await c.query('delete from partidas');
    assert.equal(await n('select ((select count(*) from respuestas) + (select count(*) from eventos))::int as n'), 0);
  });
  test('no se puede borrar un alumno con partidas por accidente, ni una asignación con partidas', async () => {
    await empezarPartida();
    await assert.rejects(c.query('delete from asignaciones'), /foreign key|violates/i);
    await assert.rejects(c.query("delete from alumnos where id = 'TDA2-01'"), /foreign key|violates/i);
  });
});
