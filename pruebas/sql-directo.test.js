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
const A = 'AAA222', B = 'BBB333', C = 'CCC444', D = 'DDD555', OTRO_GRUPO = 'EEE666';
const unirse = async (cod, sala) => (await anon('select public.directo_unirse($1, $2) as r', [cod, sala])).rows[0].r;
const miEstado = async (cod, sesion) => (await anon('select public.directo_estado($1, $2::uuid) as r', [cod, sesion])).rows[0].r;
const contestar = async (cod, sesion, q, dada) => (await anon('select public.directo_responder($1, $2::uuid, $3::int, $4::jsonb) as r', [cod, sesion, q, JSON.stringify(dada)])).rows[0].r;
const fuente = clave => BANCO.preguntas.find(p => p.id === clave.split('/')[1]);
const buena = clave => fuente(clave).ok;                                           // opción múltiple: índice (el orden de la sala es el original); verdadero/falso: boolean
const mala = clave => { const f = fuente(clave); return f.tipo === 'opcion_multiple' ? (f.ok + 1) % 4 : !f.ok; };
// Una sala con los 4 alumnos del grupo dentro y la primera pregunta abierta
async function salaEnMarcha(extra = {}, quienes = [A, B, C, D]) {
  const r = await crear({ preguntas: 3, ...extra });
  for (const cod of quienes) assert.equal((await unirse(cod, r.sala)).ok, true);
  await avanzar(r.sesion, 'espera');
  return r;
}
const n = async (sql, p) => Number((await c.query(sql, p)).rows[0].n);

test.beforeEach(async () => {
  await c.query('truncate directo_respuestas, directo_participantes, directo_sesiones, items, bancos, alumnos, grupos, profesores, accesos_fallidos cascade');
  await c.query('insert into profesores(email) values ($1)', [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II'), ('TDA1', 'TDA I')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA2-02', 'TDA2', public._hash_codigo('BBB333')), ('TDA2-03', 'TDA2', public._hash_codigo('CCC444')), ('TDA2-04', 'TDA2', public._hash_codigo('DDD555')), ('TDA1-01', 'TDA1', public._hash_codigo('EEE666'))");
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
    await c.query("update directo_sesiones set limite = now() - interval '3 seconds'");
    const e = await estado(sesion);
    assert.equal(e.estado, 'resultado'); assert.equal(e.actual, 0); assert.ok(e.resultado);
    // la pantalla del profesor aún creía que estaba en «pregunta»: no avanza dos veces, avisa
    assert.deepEqual(await avanzar(sesion, 'pregunta'), { ok: false, motivo: 'estado_cambiado', estado: 'resultado' });
    assert.equal((await estado(sesion)).actual, 0);
    // y también si nadie llama a estado: avanzar lo detecta por sí mismo
    await c.query("update directo_sesiones set estado = 'pregunta', limite = now() - interval '3 seconds'");
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

test.describe('alumno: permisos', () => {
  test('la web pública puede llamar a las 3 funciones del alumno, pero no a la interna de apodos', async () => {
    const r = await crear();
    assert.equal((await unirse(A, r.sala)).ok, true);
    assert.equal((await miEstado(A, r.sesion)).ok, true);
    assert.equal((await contestar(A, r.sesion, 0, true)).ok, false);                // la sala aún no ha empezado: no es un error de permisos
    await assert.rejects(anon('select public._directo_apodo(gen_random_uuid())'), /permission denied/);
    for (const t of ['directo_sesiones', 'directo_participantes', 'directo_respuestas']) await assert.rejects(anon('select * from public.' + t), /permission denied/, t);
  });
});

test.describe('alumno: unirse', () => {
  test('entra con su código y el de la sala, recibe un apodo «Animal Adjetivo» que no tiene nada de él, y al volver a entrar conserva apodo y puntos', async () => {
    const r = await crear();
    const j = await unirse(A, r.sala);
    assert.equal(j.ok, true); assert.equal(j.sesion, r.sesion); assert.match(j.apodo, /^\S+ \S+$/); assert.equal(j.total, 4); assert.equal(j.titulo, 'Directo');
    assert.ok(!j.apodo.includes('TDA2') && !j.apodo.includes('01'));
    await c.query("update directo_participantes set puntos = 700 where alumno = 'TDA2-01'");
    const otra = await unirse(A, r.sala);
    assert.equal(otra.apodo, j.apodo); assert.equal(await n('select count(*) n from directo_participantes'), 1);
    assert.equal(await n("select puntos n from directo_participantes where alumno = 'TDA2-01'"), 700);
  });
  test('30 alumnos en la misma sala: 30 apodos distintos', async () => {
    const r = await crear();
    for (let k = 0; k < 30; k++) {
      const id = 'TDA2-' + String(50 + k), cod = 'Q' + String(10000 + k);
      await c.query("insert into alumnos(id, grupo, codigo_hash) values ($1, 'TDA2', public._hash_codigo($2))", [id, cod]);
      assert.equal((await unirse(cod, r.sala)).ok, true);
    }
    assert.equal(await n('select count(distinct apodo) n from directo_participantes'), 30);
  });
  test('código de alumno que no existe → codigo; sala que no existe, terminada o de otro grupo → sala (sin enseñar que existe)', async () => {
    const r = await crear();
    assert.deepEqual(await unirse('ZZZ999', r.sala), { ok: false, motivo: 'codigo' });
    assert.deepEqual(await unirse(A, '999999'), { ok: false, motivo: 'sala' });
    assert.deepEqual(await unirse(OTRO_GRUPO, r.sala), { ok: false, motivo: 'sala' });
    assert.deepEqual(await unirse(A, 'abc'), { ok: false, motivo: 'sala' });
    await rpc('profe_directo_terminar', r.sesion);
    assert.deepEqual(await unirse(A, r.sala), { ok: false, motivo: 'sala' });
    assert.equal(await n('select count(*) n from directo_participantes'), 0);
  });
  test('se puede entrar con la partida ya empezada', async () => {
    const r = await crear({ preguntas: 2 });
    await unirse(A, r.sala); await avanzar(r.sesion, 'espera');
    const tarde = await unirse(B, r.sala);
    assert.equal(tarde.ok, true);
    assert.equal((await miEstado(B, r.sesion)).estado, 'pregunta');
  });
  test('demasiados códigos fallidos seguidos → espera', async () => {
    const r = await crear();
    for (let k = 0; k < 41; k++) await unirse('MAL' + k, r.sala);
    assert.deepEqual(await unirse(A, r.sala), { ok: false, motivo: 'espera' });
  });
});

test.describe('alumno: lo que ve su móvil', () => {
  test('quien no ha entrado en la sala no ve nada; tampoco el de otro grupo ni un código falso', async () => {
    const r = await crear();
    await unirse(A, r.sala);
    assert.deepEqual(await miEstado(B, r.sesion), { ok: false, motivo: 'no_participas' });
    assert.deepEqual(await miEstado(OTRO_GRUPO, r.sesion), { ok: false, motivo: 'no_encontrada' });
    assert.deepEqual(await miEstado('ZZZ999', r.sesion), { ok: false, motivo: 'codigo' });
    assert.deepEqual(await miEstado(A, '00000000-0000-4000-8000-000000000000'), { ok: false, motivo: 'no_encontrada' });
  });
  test('espera → pregunta → resultado → … → final: cada fase enseña lo que toca y NUNCA la solución antes de cerrar ni lo que contestaron otros', async () => {
    const r = await crear({ preguntas: 2 });
    await unirse(A, r.sala); await unirse(B, r.sala);
    let e = await miEstado(A, r.sesion);
    assert.equal(e.estado, 'espera'); assert.equal(e.participantes, 2); assert.equal(e.posicion, 1); assert.ok(e.apodo);
    assert.ok(!('pregunta' in e) && !('resultado' in e) && !('marcador' in e) && !('restante_ms' in e));

    await avanzar(r.sesion, 'espera');
    e = await miEstado(A, r.sesion);
    assert.equal(e.estado, 'pregunta'); assert.equal(e.respondio, false); assert.ok(e.restante_ms > 18000);
    assert.ok(e.pregunta.enun && e.pregunta.clave);
    assert.deepEqual(Object.keys(e.pregunta).filter(k => !['clave', 'tipo', 'enun', 'code', 'act', 'categoria', 'pista', 'unidad', 'ops'].includes(k)), []);
    const clave0 = e.pregunta.clave;
    assert.equal((await contestar(A, r.sesion, 0, buena(clave0))).ok, true);
    await contestar(B, r.sesion, 0, mala(clave0));
    e = await miEstado(A, r.sesion);
    assert.equal(e.respondio, true); assert.deepEqual(e.mi_dada, buena(clave0));
    for (const prohibido of ['SOLUCION-', 'TRAMPA-', '"correcta"', '"reparto"', '"sol"', '"trampa"', 'Zorro Azul']) assert.ok(!JSON.stringify(e).includes(prohibido), 'se cuela ' + prohibido);

    await avanzar(r.sesion, 'pregunta');
    e = await miEstado(A, r.sesion);
    assert.equal(e.estado, 'resultado'); assert.ok(!('pregunta' in e) && !('restante_ms' in e));
    assert.equal(e.resultado.ok, true); assert.ok(e.resultado.puntos >= 990 && e.resultado.puntos <= 1000); assert.equal(e.resultado.respondio, true);
    assert.deepEqual(e.resultado.correcta, buena(clave0)); assert.match(e.resultado.sol, /^SOLUCION-/);
    assert.ok(!('reparto' in e.resultado) && !('trampa' in e.resultado), 'el móvil no recibe el reparto de los demás');
    assert.equal(e.posicion, 1); assert.equal(e.puntos, e.resultado.puntos);
    assert.deepEqual(e.marcador.map(x => [x.yo, x.puntos > 0]), [[true, true], [false, false]]);
    const eb = await miEstado(B, r.sesion);
    assert.equal(eb.resultado.ok, false); assert.equal(eb.resultado.puntos, 0); assert.equal(eb.posicion, 2);

    await avanzar(r.sesion, 'resultado');
    await avanzar(r.sesion, 'pregunta'); await avanzar(r.sesion, 'resultado');
    e = await miEstado(A, r.sesion);
    assert.equal(e.estado, 'terminada'); assert.ok(!('pregunta' in e) && !('resultado' in e)); assert.equal(e.marcador.length, 2); assert.equal(e.aciertos, 1);
  });
  test('quien no contesta recibe «respondio: false», 0 puntos y su sitio en el marcador', async () => {
    const r = await salaEnMarcha({}, [A, B]);
    await avanzar(r.sesion, 'pregunta');
    const e = await miEstado(A, r.sesion);
    assert.equal(e.resultado.respondio, false); assert.equal(e.resultado.puntos, 0); assert.equal(e.resultado.ok, false);
  });
  test('el marcador enseña solo los 5 primeros y la posición propia, con empates en el mismo puesto', async () => {
    const r = await crear({ preguntas: 1 });
    for (const cod of [A, B, C, D]) await unirse(cod, r.sala);
    for (let k = 0; k < 4; k++) {
      const id = 'TDA2-9' + k; await c.query("insert into alumnos(id, grupo, codigo_hash) values ($1, 'TDA2', public._hash_codigo($2))", [id, 'R9' + k]); await unirse('R9' + k, r.sala);
    }
    await c.query("update directo_participantes set puntos = case alumno when 'TDA2-01' then 900 when 'TDA2-02' then 900 when 'TDA2-03' then 500 when 'TDA2-04' then 100 else 50 end where sesion = $1", [r.sesion]);
    await avanzar(r.sesion, 'espera'); await avanzar(r.sesion, 'pregunta');
    const a = await miEstado(A, r.sesion), b = await miEstado(B, r.sesion), c3 = await miEstado(C, r.sesion), d = await miEstado(D, r.sesion);
    assert.equal(a.marcador.length, 5); assert.deepEqual(a.marcador.map(x => x.puntos), [900, 900, 500, 100, 50]);
    assert.deepEqual([a.posicion, b.posicion, c3.posicion, d.posicion], [1, 1, 3, 4]);
    assert.equal(a.participantes, 8);
    assert.deepEqual(d.marcador.filter(x => x.yo).map(x => x.puntos), [100]);
  });
});

test.describe('alumno: responder y puntos', () => {
  const puntosDe = alum => n("select puntos n from directo_participantes where alumno = $1", [alum]);
  test('acertar da de 1000 a 500 según el tiempo (medido por el servidor); fallar da 0; la respuesta no dice si acertó', async () => {
    const r = await salaEnMarcha({ tiempo_s: 20 });
    const cl = (await miEstado(A, r.sesion)).pregunta.clave;
    assert.deepEqual(await contestar(A, r.sesion, 0, buena(cl)), { ok: true });                  // ni «acertó» ni nada más
    assert.ok(await puntosDe('TDA2-01') >= 990, 'al instante ≈ 1000');
    await c.query("update directo_sesiones set abierta = now() - interval '10 seconds', limite = now() + interval '10 seconds'");
    assert.deepEqual(await contestar(B, r.sesion, 0, buena(cl)), { ok: true });
    const mitad = await puntosDe('TDA2-02'); assert.ok(mitad >= 748 && mitad <= 752, 'a mitad de tiempo ≈ 750, salió ' + mitad);
    await c.query("update directo_sesiones set abierta = now() - interval '25 seconds', limite = now() + interval '0.5 second'");
    await contestar(C, r.sesion, 0, buena(cl));
    assert.equal(await puntosDe('TDA2-03'), 500);                                                  // al límite (o pasado de ms): el mínimo por acertar
    assert.deepEqual(await contestar(D, r.sesion, 0, mala(cl)), { ok: true });
    assert.equal(await puntosDe('TDA2-04'), 0);
    assert.equal(await n("select aciertos n from directo_participantes where alumno = 'TDA2-04'"), 0);
    assert.equal(await n("select aciertos n from directo_participantes where alumno = 'TDA2-01'"), 1);
  });
  test('solo cuenta la primera respuesta: contestar otra vez no cambia nada', async () => {
    const r = await salaEnMarcha({}, [A]);
    const cl = (await miEstado(A, r.sesion)).pregunta.clave;
    await contestar(A, r.sesion, 0, mala(cl));
    assert.deepEqual(await contestar(A, r.sesion, 0, buena(cl)), { ok: false, motivo: 'ya_respondida' });
    assert.equal(await puntosDe('TDA2-01'), 0);
    assert.equal(await n('select count(*) n from directo_respuestas'), 1);
    assert.equal((await c.query('select ok from directo_respuestas')).rows[0].ok, false);
  });
  test('el tiempo lo manda el servidor: el «ms» que diga el móvil no existe, y se guarda lo que midió él', async () => {
    const r = await salaEnMarcha({}, [A]);
    const cl = (await miEstado(A, r.sesion)).pregunta.clave;
    await c.query("update directo_sesiones set abierta = now() - interval '4 seconds', limite = now() + interval '16 seconds'");
    await contestar(A, r.sesion, 0, buena(cl));
    const ms = await n('select ms n from directo_respuestas'); assert.ok(ms >= 4000 && ms < 4600, 'ms ' + ms);
  });
  test('fuera de tiempo no cuenta: después del límite (con 1 s de cortesía) → cerrada; justo en la cortesía todavía vale', async () => {
    const r = await salaEnMarcha({}, [A, B]);
    const cl = (await miEstado(A, r.sesion)).pregunta.clave;
    await c.query("update directo_sesiones set limite = now() - interval '0.4 second'");
    assert.deepEqual(await contestar(A, r.sesion, 0, buena(cl)), { ok: true }, 'dentro de la cortesía de 1 s');
    await c.query("update directo_sesiones set limite = now() - interval '3 seconds'");
    assert.deepEqual(await contestar(B, r.sesion, 0, buena(cl)), { ok: false, motivo: 'cerrada' });
    assert.equal(await n('select count(*) n from directo_respuestas'), 1);
  });
  test('si el profesor cierra la pregunta ya, nadie más puede contestar (ni siquiera en el segundo de cortesía)', async () => {
    const r = await salaEnMarcha({}, [A, B]);
    const cl = (await miEstado(A, r.sesion)).pregunta.clave;
    await contestar(A, r.sesion, 0, buena(cl));
    await avanzar(r.sesion, 'pregunta');
    assert.deepEqual(await contestar(B, r.sesion, 0, buena(cl)), { ok: false, motivo: 'cerrada' });
  });
  test('otra pregunta, sala sin empezar, datos raros, no participas, otro grupo, código falso', async () => {
    const r = await crear({ preguntas: 3 });
    await unirse(A, r.sala);
    assert.deepEqual(await contestar(A, r.sesion, 0, true), { ok: false, motivo: 'otra_pregunta' });      // aún no hay pregunta (actual = -1)
    await avanzar(r.sesion, 'espera');
    const cl = (await miEstado(A, r.sesion)).pregunta.clave, esMC = fuente(cl).tipo === 'opcion_multiple';
    assert.deepEqual(await contestar(A, r.sesion, 1, true), { ok: false, motivo: 'otra_pregunta' });
    assert.deepEqual(await contestar(A, r.sesion, -1, true), { ok: false, motivo: 'otra_pregunta' });
    for (const raro of esMC ? [4, -1, 1.5, 'a', true, null, [1]] : [1, 0, 'true', null, [true]])
      assert.deepEqual(await contestar(A, r.sesion, 0, raro), { ok: false, motivo: 'dato' }, JSON.stringify(raro));
    assert.deepEqual(await contestar(B, r.sesion, 0, buena(cl)), { ok: false, motivo: 'no_participas' });
    assert.deepEqual(await contestar(OTRO_GRUPO, r.sesion, 0, buena(cl)), { ok: false, motivo: 'no_encontrada' });
    assert.deepEqual(await contestar('ZZZ999', r.sesion, 0, buena(cl)), { ok: false, motivo: 'codigo' });
    assert.deepEqual(await contestar(A, '00000000-0000-4000-8000-000000000000', 0, buena(cl)), { ok: false, motivo: 'no_encontrada' });
    assert.equal(await n('select count(*) n from directo_respuestas'), 0);
  });
  test('los puntos del participante son siempre la suma de sus respuestas, en una partida entera con 4 alumnos', async () => {
    const r = await salaEnMarcha({ preguntas: 3 });
    for (let q = 0; q < 3; q++) {
      const cl = (await miEstado(A, r.sesion)).pregunta.clave;
      await contestar(A, r.sesion, q, buena(cl)); await contestar(B, r.sesion, q, q === 1 ? mala(cl) : buena(cl));
      if (q === 0) await contestar(C, r.sesion, q, mala(cl));                                         // D no contesta nunca
      await avanzar(r.sesion, 'pregunta'); await avanzar(r.sesion, 'resultado');
    }
    assert.equal((await estado(r.sesion)).estado, 'terminada');
    const filas = (await c.query(`select p.alumno, p.puntos, p.aciertos, coalesce(sum(x.puntos), 0)::int s, count(*) filter (where x.ok)::int a
                                    from directo_participantes p left join directo_respuestas x on x.sesion = p.sesion and x.alumno = p.alumno group by p.alumno, p.puntos, p.aciertos order by p.alumno`)).rows;
    for (const f of filas) { assert.equal(f.puntos, f.s, f.alumno); assert.equal(f.aciertos, f.a, f.alumno); }
    assert.deepEqual(filas.map(f => f.aciertos), [3, 2, 0, 0]);
    assert.ok(filas[0].puntos > filas[1].puntos && filas[1].puntos > 0 && filas[3].puntos === 0);
    const fin = await miEstado(A, r.sesion); assert.equal(fin.posicion, 1); assert.equal(fin.marcador[0].yo, true);
  });
  test('el profesor ve quién está conectado y quién ya contestó', async () => {
    const r = await salaEnMarcha({}, [A, B]);
    const cl = (await miEstado(A, r.sesion)).pregunta.clave;
    await contestar(A, r.sesion, 0, buena(cl));
    await c.query("update directo_participantes set visto = now() - interval '30 seconds' where alumno = 'TDA2-02'");
    const e = await estado(r.sesion);
    assert.deepEqual(e.participantes.map(p => [p.alumno, p.respondio, p.conectado]).sort(), [['TDA2-01', true, true], ['TDA2-02', false, false]]);
    await miEstado(B, r.sesion);                                                                   // el móvil pregunta por el estado: «latido» de conexión
    assert.equal((await estado(r.sesion)).participantes.find(p => p.alumno === 'TDA2-02').conectado, true);
  });
});

test.describe('pausa de lectura, apodo libre y expulsar (mejoras tras el primer directo en clase)', () => {
  const apodoDe = async (cod, ses, ap) => (await anon('select public.directo_apodo($1, $2::uuid, $3) as r', [cod, ses, ap])).rows[0].r;
  const expulsar = (ses, alumno) => rpc('profe_directo_expulsar', ses, alumno);

  test('con pausa de lectura: sale el enunciado SIN opciones, no se puede contestar, y al acabar la pausa salen las opciones y el tiempo empieza ahí', async () => {
    const r = await salaEnMarcha({ lectura_s: 3, tiempo_s: 20 }, [A]);
    const e = await miEstado(A, r.sesion);
    assert.equal(e.estado, 'pregunta'); assert.ok(e.lectura_ms > 1500 && e.lectura_ms <= 3000, 'lectura_ms ' + e.lectura_ms);
    assert.ok(e.restante_ms > 22000 && e.restante_ms <= 23000, 'restante_ms ' + e.restante_ms);        // 3 s de lectura + 20 s para contestar
    assert.equal(e.pregunta.ops, undefined); assert.ok(e.pregunta.enun);
    assert.equal((await estado(r.sesion)).pregunta.ops, undefined);                                   // el proyector tampoco las recibe
    assert.deepEqual(await contestar(A, r.sesion, 0, true), { ok: false, motivo: 'aun_no' });
    assert.equal(await n('select count(*) n from directo_respuestas'), 0);
    await c.query("update directo_sesiones set abierta = now() - interval '1 second', limite = now() + interval '19 seconds'");   // pasa la pausa
    const f = await miEstado(A, r.sesion);
    assert.equal(f.lectura_ms, 0);
    if (f.pregunta.tipo === 'opcion_multiple') assert.equal(f.pregunta.ops.length, 4);
    assert.equal((await contestar(A, r.sesion, 0, f.pregunta.tipo === 'opcion_multiple' ? 1 : true)).ok, true);
    const ms = await n('select ms n from directo_respuestas'); assert.ok(ms >= 0 && ms < 3000, 'ms ' + ms);      // medidos desde que salieron las opciones
  });
  test('sin pausa (lectura_s 0, lo de siempre) las opciones salen a la vez', async () => {
    const r = await salaEnMarcha({}, [A]);
    const e = await miEstado(A, r.sesion);
    assert.equal(e.lectura_ms, 0);
    if (e.pregunta.tipo === 'opcion_multiple') assert.equal(e.pregunta.ops.length, 4);
    assert.equal((await contestar(A, r.sesion, 0, e.pregunta.tipo === 'opcion_multiple' ? 1 : true)).ok, true);
  });
  test('lectura_s y apodo_libre mal puestos: mensaje claro y no se crea nada', async () => {
    for (const [extra, msg] of [[{ lectura_s: 11 }, 'lectura_s debe ser un entero de 0 a 10'], [{ lectura_s: -1 }, 'lectura_s debe ser un entero de 0 a 10'], [{ lectura_s: 1.5 }, 'lectura_s debe ser un entero de 0 a 10'],
                                [{ lectura_s: 'tres' }, 'lectura_s debe ser un entero de 0 a 10'], [{ apodo_libre: 'si' }, 'apodo_libre debe ser verdadero o falso']])
      await assert.rejects(crear(extra), new RegExp('directo_no_valido: ' + msg), JSON.stringify(extra));
    assert.equal(await n('select count(*) n from directo_sesiones'), 0);
  });

  test('apodo libre: se cambia en la espera, con reglas, sin repetir y solo si el profesor lo activó', async () => {
    const r = await crear({ apodo_libre: true });
    const u = await unirse(A, r.sala); assert.equal(u.ok, true); assert.equal(u.apodo_libre, true);
    assert.equal((await unirse(B, r.sala)).ok, true);
    assert.deepEqual(await apodoDe(A, r.sesion, '  Capitán   Kiron '), { ok: true, apodo: 'Capitán Kiron' });         // espacios recortados y juntados
    assert.equal((await miEstado(A, r.sesion)).apodo, 'Capitán Kiron');
    assert.equal((await estado(r.sesion)).participantes.some(p => p.apodo === 'Capitán Kiron' && p.alumno === 'TDA2-01'), true);
    assert.deepEqual(await apodoDe(B, r.sesion, 'capitán kiron'), { ok: false, motivo: 'ocupado' });                  // sin distinguir mayúsculas
    assert.deepEqual(await apodoDe(A, r.sesion, 'capitán KIRON'), { ok: true, apodo: 'capitán KIRON' });             // el suyo propio sí puede retocarlo
    for (const malo of ['x', '', '   ', 'a'.repeat(17), '<b>hola</b>', 'ho\u0007la']) assert.deepEqual(await apodoDe(B, r.sesion, malo), { ok: false, motivo: 'dato' }, JSON.stringify(malo));
    assert.deepEqual(await apodoDe(B, r.sesion, null), { ok: false, motivo: 'dato' });
    assert.equal((await apodoDe(B, r.sesion, 'Ñandú_1')).ok, true);                                                   // acentos y símbolos normales valen
    assert.deepEqual(await apodoDe(C, r.sesion, 'Nuevo'), { ok: false, motivo: 'no_participas' });                    // no ha entrado
    assert.deepEqual(await apodoDe(OTRO_GRUPO, r.sesion, 'Nuevo'), { ok: false, motivo: 'no_encontrada' });           // otro grupo: como si no existiera
    assert.deepEqual(await apodoDe('ZZZ999', r.sesion, 'Nuevo'), { ok: false, motivo: 'codigo' });
    await avanzar(r.sesion, 'espera');
    assert.deepEqual(await apodoDe(A, r.sesion, 'Tarde'), { ok: false, motivo: 'empezada' });                          // ya no se cambia
  });
  test('sin «apodo libre» nadie puede cambiarse el apodo', async () => {
    const r = await crear();
    const u = await unirse(A, r.sala); assert.equal(u.apodo_libre, false);
    assert.deepEqual(await apodoDe(A, r.sesion, 'Quiero este'), { ok: false, motivo: 'no_libre' });
    assert.equal((await miEstado(A, r.sesion)).apodo, u.apodo);
  });

  test('expulsar: borra al alumno de la sala, se ve en el estado y no puede volver a entrar; los demás siguen', async () => {
    const r = await salaEnMarcha({}, [A, B]);
    const cl = (await miEstado(A, r.sesion)).pregunta.clave;
    await contestar(A, r.sesion, 0, buena(cl));
    assert.deepEqual(await expulsar(r.sesion, 'TDA2-01'), { ok: true });
    assert.deepEqual((await estado(r.sesion)).participantes.map(p => p.alumno), ['TDA2-02']);
    assert.equal(await n('select count(*) n from directo_respuestas'), 0);                                            // sus respuestas se van con él
    assert.deepEqual(await miEstado(A, r.sesion), { ok: false, motivo: 'no_participas' });
    assert.deepEqual(await unirse(A, r.sala), { ok: false, motivo: 'expulsado' });
    assert.deepEqual(await contestar(A, r.sesion, 0, buena(cl)), { ok: false, motivo: 'no_participas' });
    assert.equal((await miEstado(B, r.sesion)).ok, true);
    assert.equal((await unirse(C, r.sala)).ok, true);                                                                  // otros sí pueden entrar
    assert.deepEqual(await expulsar(r.sesion, 'TDA2-01'), { ok: false, motivo: 'no_participa' });
    assert.deepEqual(await expulsar('00000000-0000-4000-8000-000000000000', 'TDA2-01'), { ok: false, motivo: 'no_encontrada' });
  });
  test('expulsar: solo el profesor, y solo vale para ESA sala (en otra sala el alumno entra)', async () => {
    const r = await crear();
    await unirse(A, r.sala);
    await assert.rejects(anon('select public.profe_directo_expulsar($1::uuid, $2)', [r.sesion, 'TDA2-01']), /permission denied/);
    await assert.rejects(comoUsuario(c, OTRO, 'select public.profe_directo_expulsar($1::uuid, $2)', [r.sesion, 'TDA2-01']), /no_autorizado|permission denied/);
    assert.equal((await miEstado(A, r.sesion)).ok, true);                                                              // nada cambió
    await expulsar(r.sesion, 'TDA2-01');
    await rpc('profe_directo_terminar', r.sesion);
    const r2 = await crear();
    assert.equal((await unirse(A, r2.sala)).ok, true);
  });
  test('la web pública puede llamar a directo_apodo y no puede leer directo_expulsados', async () => {
    await assert.rejects(anon('select * from public.directo_expulsados'), /permission denied/);
    assert.equal((await anon("select public.directo_apodo('ZZZ999', gen_random_uuid(), 'x') as r")).rows[0].r.motivo, 'codigo');
  });
});
