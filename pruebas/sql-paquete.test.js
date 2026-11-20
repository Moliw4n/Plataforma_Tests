/* El paquete SQL para el proyecto de PRUEBAS (supabase/paquete_pruebas.sql): está al día, se instala de punta a punta en un Postgres real
   y la guarda protege una base con alumnos reales. Se ejecuta con: npm run test:sql */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { SQL, iniciar, parar, baseNueva, como, comoUsuario } = require('./ayuda-sql');

const RAIZ = path.join(__dirname, '..');
let P;
test.before(async () => { await iniciar(); P = await import(pathToFileURL(path.join(RAIZ, 'scripts', 'empaquetar-sql.mjs')).href); });
test.after(parar);

test('el paquete está al día: coincide con juntar los archivos (si falla, ejecuta npm run empaquetar-sql)', () => {
  assert.equal(fs.readFileSync(P.DESTINO, 'utf8'), P.construirPaquete());
});
test('lleva todos los archivos, por orden, y la guarda va ANTES que ninguno', () => {
  const t = fs.readFileSync(P.DESTINO, 'utf8');
  const pos = P.ARCHIVOS.map(f => t.indexOf('##################### ' + f));
  assert.ok(pos.every(x => x > 0)); assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.ok(t.indexOf('do $guarda$') < pos[0]);
});
test('el archivo es texto normal (sin caracteres raros que el editor de Supabase pueda mostrar como saltos de línea)', () => {
  const t = fs.readFileSync(P.DESTINO, 'utf8');
  for (const c of t) { const n = c.codePointAt(0); assert.ok(!(n === 0x2028 || n === 0x2029 || n === 0x85 || n === 0xFEFF || n === 0x200B || (n < 32 && !'\n\t\r'.includes(c))), 'carácter raro U+' + n.toString(16)); }
});

test.describe('en un proyecto nuevo (vacío)', () => {
  let c;
  test.before(async () => { c = await baseNueva('paquete', []); });
  const comprobacion = async () => (await c.query('select 1')).rows && null;

  test('se instala de una vez y la fila de comprobación sale como dice el archivo', async () => {
    const r = await c.query(fs.readFileSync(P.DESTINO, 'utf8'));
    const ultima = Array.isArray(r) ? r[r.length - 1] : r;
    assert.deepEqual(ultima.rows[0], { tablas: '13', tablas_sin_rls: '0', alumnos_de_prueba: '5', funciones_alumno: '9', funciones_profe: '12' });
  });
  test('se puede ejecutar otra vez sin romper nada', async () => {
    const r = await c.query(fs.readFileSync(P.DESTINO, 'utf8'));
    assert.equal((Array.isArray(r) ? r[r.length - 1] : r).rows[0].alumnos_de_prueba, '5');
  });
  test('queda todo cerrado a la web pública, pero un alumno de prueba entra con su código', async () => {
    for (const t of ['alumnos', 'intentos', 'bancos', 'items', 'partidas', 'respuestas', 'eventos', 'latidos'])
      await assert.rejects(como(c, 'anon', 'select * from public.' + t), /permission denied/, t);
    assert.deepEqual((await como(c, 'anon', "select public.entrar('AAA-222') as r")).rows[0].r, { ok: true, alumno: 'PRUEBA-01', grupo: 'PRUEBA' });
    assert.equal((await como(c, 'anon', 'select public.latido() as r')).rows[0].r.ok, true);
  });
  test('un examen completo con el paquete: el profesor sube un banco, crea el examen y un alumno de prueba lo hace', async () => {
    await c.query("insert into public.profesores(email) values ('profe@ejemplo.test')");
    const banco = { formato: 2, id: 'b', titulo: 'Banco', preguntas: Array.from({ length: 4 }, (_, i) => ({ id: 'p' + i, tipo: 'verdadero_falso', ok: true, enun: 'E' + i, sol: 's', trampa: 't' })) };
    const profe = (sql, p) => comoUsuario(c, 'profe@ejemplo.test', sql, p);
    await profe('select public.profe_subir_banco($1::jsonb)', [JSON.stringify(banco)]);
    await profe('select public.profe_crear_juego($1::jsonb)', [JSON.stringify({ id: 'ensayo', modo: 'examen', titulo: 'Ensayo', bancos: ['b'], reglas: { preguntas: 4, tiempo_min: 5 } })]);
    const asg = (await profe("select public.profe_asignar('ensayo', 'PRUEBA') as r")).rows[0].r.asignacion;
    const r = (await como(c, 'anon', 'select public.empezar_partida($1, $2::bigint) as r', ['AAA222', asg])).rows[0].r;
    assert.equal(r.ok, true); assert.equal(r.items.length, 4);
    for (const i of r.items) await como(c, 'anon', 'select public.responder($1, $2::uuid, $3, $4::jsonb)', ['AAA222', r.partida, i.clave, 'true']);
    await como(c, 'anon', 'select public.terminar_partida($1, $2::uuid)', ['AAA222', r.partida]);
    const res = (await profe('select public.profe_resultados($1::bigint) as r', [asg])).rows[0].r;
    assert.equal(Number(res.partidas[0].nota), 10);
  });
});

test('la guarda: una base con alumnos REALES no se toca (ni una tabla nueva)', async () => {
  const c = await baseNueva('real', ['01_esquema.sql', '03_profesor_alumnos.sql']);
  await c.query("insert into public.grupos(id, nombre) values ('TDA2', 'TDA II')");
  await c.query("insert into public.alumnos(id, grupo, codigo_hash) values ('TDA2-07', 'TDA2', public._hash_codigo('K7M4QX'))");
  await assert.rejects(c.query(fs.readFileSync(P.DESTINO, 'utf8')), /alumnos reales/);
  assert.equal((await c.query("select to_regclass('public.bancos') as t")).rows[0].t, null, 'no debe haber creado nada');
  assert.equal((await c.query("select to_regclass('public.latidos') as t")).rows[0].t, null);
  assert.equal((await c.query('select count(*)::int n from public.alumnos')).rows[0].n, 1);
});
