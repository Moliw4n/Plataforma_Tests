/* Pruebas de supabase/09_directo.sql (modo DIRECTO) contra un Postgres REAL y LOCAL, en UTF8. Nunca toca Supabase.
   Paso 1: tablas y funciones del PROFESOR (crear sala, estado, avanzar, terminar, activas, borrar). Se ejecuta con: npm run test:sql */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SQL, iniciar, parar, baseNueva, como, comoUsuario } = require('./ayuda-sql');

const PROFE = 'profe@ejemplo.test', OTRO = 'otro@ejemplo.test';
const it = (id, extra) => ({ id, enun: 'Enunciado ' + id, sol: 'SOLUCION-' + id, trampa: 'TRAMPA-' + id, ...extra });
const BANCO = { formato: 2, id: 'dir', titulo: 'Banco del directo', materia: 'TDA I', preguntas: [
  ...['t1', 't2', 't3'].flatMap((tema, ti) => [
    it(tema + 'mc', { tipo: 'opcion_multiple', ops: ['A ' + tema, 'B ' + tema, 'C ' + tema, 'D ' + tema], ok: 1, tema }),
    it(tema + 'vf', { tipo: 'verdadero_falso', ok: ti % 2 === 0, tema })]),
  it('num', { tipo: 'numerica', valor: 5, tema: 't1' }),                                  // no se juega en directo
  it('corta', { tipo: 'respuesta_corta', aceptadas: ['hola'], tema: 't2' })] };            // tampoco
const BANCO_VACIO = { formato: 2, id: 'solonum', titulo: 'Solo numéricas', materia: 'TDA I', preguntas: [it('n1', { tipo: 'numerica', valor: 1 })] };

let c;
test.before(async () => {
  await iniciar();
  c = await baseNueva('directo', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '06_contenido.sql', '07_examen.sql', '09_directo.sql']);
});
test.after(parar);

const profe = (sql, params) => comoUsuario(c, PROFE, sql, params);
const anon = (sql, p) => como(c, 'anon', sql, p);
const rpc = async (fn, ...args) => (await profe('select public.' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(', ') + ') as r', args)).rows[0].r;
const crear = (extra = {}) => rpc('profe_directo_crear', JSON.stringify({ grupo: 'TDA2', bancos: ['dir'], preguntas: 4, tiempo_s: 20, ...extra }));
const estado = id => rpc('profe_directo_estado', id);
const avanzar = (id, desde) => rpc('profe_directo_avanzar', id, desde);
const n = async (sql, p) => Number((await c.query(sql, p)).rows[0].n);

test.beforeEach(async () => {
  await c.query('truncate directo_respuestas, directo_participantes, directo_sesiones, items, bancos, alumnos, grupos, profesores, accesos_fallidos cascade');
  await c.query('insert into profesores(email) values ($1)', [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II'), ('TDA1', 'TDA I')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA2-02', 'TDA2', public._hash_codigo('BBB333'))");
  await profe('select public.profe_subir_banco($1::jsonb)', [JSON.stringify(BANCO)]);
  await profe('select public.profe_subir_banco($1::jsonb)', [JSON.stringify(BANCO_VACIO)]);
});

test.describe('permisos', () => {
  test('la web pública no puede llamar a nada del profesor ni a las internas, ni leer las tablas; alguien que no es profesor tampoco', async () => {
    for (const sql of ["select public.profe_directo_crear('{}'::jsonb)", "select public.profe_directo_estado(gen_random_uuid())", "select public.profe_directo_avanzar(gen_random_uuid(), 'espera')",
      "select public.profe_directo_terminar(gen_random_uuid())", "select public.profe_directo_activas()", "select public.profe_directo_borrar(gen_random_uuid())",
      "select public._directo_al_dia(gen_random_uuid())", "select public._directo_pregunta(gen_random_uuid(), 0)", "select public._directo_resultado(gen_random_uuid(), 0)"])
      await assert.rejects(anon(sql), /permission denied/, sql);
    for (const t of ['directo_sesiones', 'directo_participantes', 'directo_respuestas']) await assert.rejects(anon('select * from public.' + t), /permission denied/, t);
    for (const sql of ["select public.profe_directo_crear('{}'::jsonb)", "select public.profe_directo_activas()", "select public.profe_directo_estado(gen_random_uuid())"])
      await assert.rejects(comoUsuario(c, OTRO, sql), /no_autorizado/, sql);
  });
  test('el profesor solo LEE las tablas: escribir directamente está prohibido', async () => {
    const r = await crear();
    await assert.rejects(profe("insert into directo_sesiones(sala, grupo, titulo, bancos, preguntas, tiempo_s) values ('111111', 'TDA2', 'x', array['dir'], '[]', 20)"), /permission denied/);
    await assert.rejects(profe('update directo_sesiones set estado = $1 where id = $2', ['terminada', r.sesion]), /permission denied/);
    await assert.rejects(profe('delete from directo_sesiones'), /permission denied/);
    assert.equal((await profe('select count(*)::int n from directo_sesiones')).rows[0].n, 1);       // leer sí
  });
  test('09 se puede ejecutar dos veces seguidas', async () => { await c.query(SQL('09_directo.sql')); await c.query(SQL('09_directo.sql')); });
});

test.describe('crear una sala', () => {
  test('da un código de 6 cifras, elige solo opción múltiple y verdadero/falso, y las opciones salen en su orden', async () => {
    const r = await crear({ preguntas: 6 });
    assert.equal(r.ok, true); assert.match(r.sala, /^[0-9]{6}$/); assert.equal(r.total, 6); assert.equal(r.tiempo_s, 20);
    const s = (await c.query('select * from directo_sesiones')).rows[0];
    assert.equal(s.estado, 'espera'); assert.equal(s.actual, -1); assert.equal(s.grupo, 'TDA2'); assert.equal(s.titulo, 'Directo');
    const tipos = (await c.query(`select i.tipo from directo_sesiones d, jsonb_array_elements(d.preguntas) e join items i on i.banco = e ->> 'banco' and i.id = e ->> 'id'`)).rows.map(x => x.tipo);
    assert.equal(tipos.length, 6); assert.ok(tipos.every(t => t === 'opcion_multiple' || t === 'verdadero_falso'), tipos.join());
    const mc = s.preguntas.filter(p => p.id.endsWith('mc'));
    assert.ok(mc.length > 0 && mc.every(p => JSON.stringify(p.ops_orden) === '[0,1,2,3]'), 'el orden de las opciones es fijo: 0,1,2,3');
    assert.ok(s.preguntas.filter(p => p.id.endsWith('vf')).every(p => p.ops_orden === null), 'verdadero/falso no lleva orden de opciones');
  });
  test('con «equilibrar por tema» y 3 preguntas sale una de cada tema; las preguntas no se repiten', async () => {
    for (let k = 0; k < 15; k++) {
      await c.query('truncate directo_sesiones cascade');
      await crear({ preguntas: 3 });
      const claves = (await c.query(`select e ->> 'clave' c from directo_sesiones d, jsonb_array_elements(d.preguntas) e`)).rows.map(x => x.c);
      assert.equal(new Set(claves).size, 3);
      const temas = (await c.query(`select i.tema from directo_sesiones d, jsonb_array_elements(d.preguntas) e join items i on i.banco = e ->> 'banco' and i.id = e ->> 'id'`)).rows.map(x => x.tema);
      assert.deepEqual([...temas].sort(), ['t1', 't2', 't3']);
    }
  });
  test('los códigos de sala no se repiten entre salas abiertas (40 salas, 40 códigos) y el de una terminada se puede reutilizar', async () => {
    const cods = new Set(); let ult;
    for (let k = 0; k < 40; k++) { ult = await crear({ preguntas: 1 }); cods.add(ult.sala); }
    assert.equal(cods.size, 40);
    await assert.rejects(c.query("update directo_sesiones set sala = (select sala from directo_sesiones where id <> $1 limit 1) where id = $1", [ult.sesion]), /unique|duplicate/i);
    await rpc('profe_directo_terminar', ult.sesion);
    await c.query('update directo_sesiones set sala = $1 where id = (select id from directo_sesiones where estado = $2 limit 1)', [(await c.query("select sala from directo_sesiones where estado = 'espera' limit 1")).rows[0].sala, 'terminada']);
  });
  test('datos mal puestos: mensajes claros y no se crea nada', async () => {
    const mal = {
      'el grupo no existe': { grupo: 'NOPE' }, 'el grupo no existe  ': { grupo: null },
      'algún banco no existe': { bancos: ['dir', 'nope'] }, 'bancos debe ser una lista de 1 a 10': { bancos: [] },
      'bancos debe ser una lista de textos': { bancos: [1] }, 'bancos debe ser una lista de 1 a 10 bancos': { bancos: 'dir' },
      'preguntas debe ser un entero de 1 a 50': { preguntas: 0 }, 'preguntas debe ser un entero de 1 a 50 ': { preguntas: 2.5 },
      'tiempo_s debe ser un entero de 5 a 120': { tiempo_s: 4 }, 'tiempo_s debe ser un entero de 5 a 120 ': { tiempo_s: 121 },
      'equilibrar debe ser': { equilibrar: 'mucho' }, 'titulo debe ser': { titulo: '   ' },
      'pides 7 preguntas y los bancos solo tienen 6': { preguntas: 7 }
    };
    for (const [msg, extra] of Object.entries(mal)) {
      const datos = { grupo: 'TDA2', bancos: ['dir'], preguntas: 4, tiempo_s: 20, ...extra };
      await assert.rejects(rpc('profe_directo_crear', JSON.stringify(datos)), new RegExp('directo_no_valido: .*' + msg.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), msg);
    }
    await assert.rejects(rpc('profe_directo_crear', '[]'), /directo_no_valido: no es un objeto/);
    await assert.rejects(crear({ bancos: ['solonum'], preguntas: 1 }), /los bancos solo tienen 0 de opción múltiple o verdadero\/falso/);
    assert.equal(await n('select count(*) n from directo_sesiones'), 0);
  });
  test('las salas olvidadas (más de 12 horas) se cierran solas al abrir otra, y se libera su código', async () => {
    const vieja = await crear({ preguntas: 1 });
    await c.query("update directo_sesiones set creada = now() - interval '13 hours'");
    const nueva = await crear({ preguntas: 1 });
    assert.equal((await c.query('select estado from directo_sesiones where id = $1', [vieja.sesion])).rows[0].estado, 'terminada');
    assert.equal((await c.query('select estado from directo_sesiones where id = $1', [nueva.sesion])).rows[0].estado, 'espera');
  });
});

test.describe('estado y avanzar', () => {
  test('en la espera no hay pregunta ni resultado; no se cuela ninguna solución en ningún momento', async () => {
    const { sesion } = await crear({ preguntas: 3 });
    const e = await estado(sesion);
    assert.equal(e.ok, true); assert.equal(e.estado, 'espera'); assert.equal(e.actual, -1); assert.equal(e.total, 3); assert.deepEqual(e.participantes, []);
    assert.ok(!('pregunta' in e) && !('resultado' in e) && !('restante_ms' in e) && !('respondidas' in e));
    assert.match(e.sala, /^[0-9]{6}$/); assert.equal(e.grupo, 'TDA2');
    // en pregunta: la pregunta de la lista blanca, sin soluciones
    const p = await avanzar(sesion, 'espera'); assert.deepEqual(p, { ok: true, estado: 'pregunta', actual: 0 });
    const ep = await estado(sesion);
    assert.equal(ep.estado, 'pregunta'); assert.equal(ep.actual, 0);
    assert.ok(ep.restante_ms > 18000 && ep.restante_ms <= 20000, 'restante ' + ep.restante_ms);
    assert.ok(ep.pregunta.enun && ep.pregunta.clave); assert.ok(!('resultado' in ep));
    const texto = JSON.stringify(ep);
    for (const prohibido of ['SOLUCION-', 'TRAMPA-', '"sol"', '"trampa"', 'valor', 'aceptadas', '"correcta"', '"reparto"']) assert.ok(!texto.includes(prohibido), 'se cuela ' + prohibido + ' en ' + texto);
    assert.deepEqual(Object.keys(ep.pregunta).filter(k => !['clave', 'tipo', 'enun', 'code', 'act', 'categoria', 'pista', 'unidad', 'ops'].includes(k)), [], 'la pregunta solo lleva campos de la lista blanca');
    if (ep.pregunta.tipo === 'opcion_multiple') assert.equal(ep.pregunta.ops.length, 4);
  });
  test('recorrido completo: espera → pregunta → resultado → … → terminada, y luego ya no avanza', async () => {
    const { sesion } = await crear({ preguntas: 2 });
    assert.deepEqual(await avanzar(sesion, 'espera'), { ok: true, estado: 'pregunta', actual: 0 });
    assert.deepEqual(await avanzar(sesion, 'pregunta'), { ok: true, estado: 'resultado', actual: 0 });        // cerrar ya
    const er = await estado(sesion);
    assert.equal(er.estado, 'resultado'); assert.ok(!('restante_ms' in er));
    assert.ok(er.resultado.sol.startsWith('SOLUCION-') && er.resultado.trampa.startsWith('TRAMPA-'), 'ahora sí se ve el porqué'); assert.ok(er.resultado.reparto.length >= 2);
    assert.deepEqual(await avanzar(sesion, 'resultado'), { ok: true, estado: 'pregunta', actual: 1 });
    assert.ok(!('resultado' in (await estado(sesion))), 'al abrir la siguiente desaparece la solución anterior');
    await avanzar(sesion, 'pregunta');
    assert.deepEqual(await avanzar(sesion, 'resultado'), { ok: true, estado: 'terminada', actual: 1 });
    const et = await estado(sesion);
    assert.equal(et.estado, 'terminada'); assert.ok(!('pregunta' in et));
    assert.deepEqual(await avanzar(sesion, 'terminada'), { ok: false, motivo: 'terminada' });
    assert.equal((await c.query('select terminada is not null t from directo_sesiones')).rows[0].t, true);
  });
  test('si se acaba el tiempo la sala pasa sola a «resultado»; pulsar «Siguiente» en ese instante no se salta el resultado', async () => {
    const { sesion } = await crear({ preguntas: 3 });
    await avanzar(sesion, 'espera');
    await c.query("update directo_sesiones set limite = now() - interval '1 second'");
    const e = await estado(sesion);
    assert.equal(e.estado, 'resultado'); assert.equal(e.actual, 0); assert.ok(e.resultado);
    // la pantalla del profesor aún creía que estaba en «pregunta»: no avanza dos veces, avisa
    assert.deepEqual(await avanzar(sesion, 'pregunta'), { ok: false, motivo: 'estado_cambiado', estado: 'resultado' });
    assert.equal((await estado(sesion)).actual, 0);
    // y también si nadie llama a estado: avanzar lo detecta por sí mismo
    await c.query("update directo_sesiones set estado = 'pregunta', limite = now() - interval '1 second'");
    assert.deepEqual(await avanzar(sesion, 'pregunta'), { ok: false, motivo: 'estado_cambiado', estado: 'resultado' });
  });
  test('«avanzar» con un estado equivocado no hace nada', async () => {
    const { sesion } = await crear();
    assert.deepEqual(await avanzar(sesion, 'resultado'), { ok: false, motivo: 'estado_cambiado', estado: 'espera' });
    assert.equal((await estado(sesion)).estado, 'espera');
  });
  test('una sala que no existe → no_encontrada', async () => {
    const x = '00000000-0000-4000-8000-000000000000';
    assert.deepEqual(await estado(x), { ok: false, motivo: 'no_encontrada' });
    assert.deepEqual(await avanzar(x, 'espera'), { ok: false, motivo: 'no_encontrada' });
    assert.deepEqual(await rpc('profe_directo_terminar', x), { ok: false });
    assert.deepEqual(await rpc('profe_directo_borrar', x), { ok: false });
  });
  test('el reparto de respuestas cuenta bien, para opción múltiple y para verdadero/falso', async () => {
    const { sesion } = await crear({ preguntas: 6 });
    for (const a of ['TDA2-01', 'TDA2-02']) await c.query("insert into directo_participantes(sesion, alumno, apodo) values ($1, $2, $3)", [sesion, a, 'Apodo ' + a]);
    await avanzar(sesion, 'espera');
    // recorre las 6 preguntas contestando directamente en la tabla (las funciones del alumno llegan en el paso 2)
    for (let q = 0; q < 6; q++) {
      const e = await estado(sesion), esMC = e.pregunta.tipo === 'opcion_multiple';
      await c.query('insert into directo_respuestas(sesion, alumno, pregunta, dada, ok) values ($1, $2, $3, $4::jsonb, false), ($1, $5, $3, $6::jsonb, false)',
        [sesion, 'TDA2-01', q, esMC ? '1' : 'true', 'TDA2-02', esMC ? '1' : 'false']);
      assert.equal((await estado(sesion)).respondidas, 2);
      await avanzar(sesion, 'pregunta');
      const r = (await estado(sesion)).resultado;
      if (esMC) { assert.deepEqual(r.reparto.map(x => x.veces), [0, 2, 0, 0]); assert.deepEqual(r.reparto.map(x => x.correcta), [false, true, false, false]); assert.equal(r.correcta, 1); }
      else { assert.deepEqual(r.reparto.map(x => [x.texto, x.veces]), [['Verdadero', 1], ['Falso', 1]]); assert.equal(r.reparto.filter(x => x.correcta).length, 1); }
      await avanzar(sesion, 'resultado');
    }
    assert.equal((await estado(sesion)).estado, 'terminada');
  });
  test('los participantes salen ordenados por puntos, con quién ya contestó', async () => {
    const { sesion } = await crear({ preguntas: 2 });
    await c.query("insert into directo_participantes(sesion, alumno, apodo, puntos) values ($1, 'TDA2-01', 'Zorro Azul', 300), ($1, 'TDA2-02', 'Lobo Rojo', 900)", [sesion]);
    await avanzar(sesion, 'espera');
    await c.query("insert into directo_respuestas(sesion, alumno, pregunta, dada, ok) values ($1, 'TDA2-01', 0, '1', true)", [sesion]);
    const e = await estado(sesion);
    assert.deepEqual(e.participantes.map(p => [p.apodo, p.puntos, p.respondio]), [['Lobo Rojo', 900, false], ['Zorro Azul', 300, true]]);
    assert.equal(e.respondidas, 1);
  });
});

test.describe('terminar, listar y borrar', () => {
  test('«activas» solo lista las salas abiertas; terminar la quita; borrar se lleva participantes y respuestas', async () => {
    const a = await crear({ preguntas: 2 }), b = await crear({ preguntas: 2 });
    assert.equal((await rpc('profe_directo_activas')).salas.length, 2);
    assert.deepEqual(await rpc('profe_directo_terminar', a.sesion), { ok: true });
    assert.deepEqual(await rpc('profe_directo_terminar', a.sesion), { ok: true });                   // repetir no rompe nada
    const act = (await rpc('profe_directo_activas')).salas;
    assert.deepEqual(act.map(s => s.sesion), [b.sesion]);
    assert.equal(act[0].participantes, 0); assert.equal(act[0].estado, 'espera');
    assert.equal((await estado(a.sesion)).estado, 'terminada');
    await c.query("insert into directo_participantes(sesion, alumno, apodo) values ($1, 'TDA2-01', 'X')", [b.sesion]);
    await c.query("insert into directo_respuestas(sesion, alumno, pregunta, dada, ok) values ($1, 'TDA2-01', 0, '1', true)", [b.sesion]);
    assert.deepEqual(await rpc('profe_directo_borrar', b.sesion), { ok: true });
    assert.equal(await n('select count(*) n from directo_sesiones where id = $1', [b.sesion]), 0);
    assert.equal(await n('select count(*) n from directo_participantes'), 0); assert.equal(await n('select count(*) n from directo_respuestas'), 0);
  });
  test('si se borra un alumno de la base, sus datos del directo se van con él (sin dejar huérfanos)', async () => {
    const { sesion } = await crear({ preguntas: 1 });
    await c.query("insert into directo_participantes(sesion, alumno, apodo) values ($1, 'TDA2-01', 'X')", [sesion]);
    await c.query("delete from alumnos where id = 'TDA2-01'");
    assert.equal(await n('select count(*) n from directo_participantes'), 0);
  });
});
