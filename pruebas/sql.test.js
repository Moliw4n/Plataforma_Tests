/* Pruebas del SQL de supabase/ contra un Postgres REAL y LOCAL (embedded-postgres, en una carpeta
   temporal). Nunca toca Supabase. Se ejecuta con: npm run test:sql
   Simula lo que Supabase pone de serie: los roles anon y authenticated, el esquema `extensions`
   y auth.jwt(). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');

let PUERTO;   // se elige un puerto libre al arrancar
const libre = () => new Promise((ok, mal) => { const srv = require('net').createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => ok(p)); }); srv.on('error', mal); });
const SQL = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
const PRELUDIO = `
  do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $r$;
  grant anon, authenticated to current_user;
  create schema if not exists extensions;
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth, extensions to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`;

let pg, dir;
const conexiones = [];
async function conectar(db) {
  const c = new Client({ host: 'localhost', port: PUERTO, user: 'postgres', password: 'postgres', database: db });
  await c.connect(); conexiones.push(c); return c;
}
async function baseNueva(nombre, ficheros = ['01_esquema.sql', '03_profesor_alumnos.sql']) {
  await pg.createDatabase(nombre);
  const c = await conectar(nombre);
  await c.query(PRELUDIO);
  for (const f of ficheros) await c.query(SQL(f));
  return c;
}
// Ejecuta una consulta «como» un rol (lo que haría la web pública), y vuelve a ser superusuario.
async function como(c, rol, sql, params) {
  await c.query('set role ' + rol);
  try { return await c.query(sql, params); } finally { await c.query('reset role'); }
}

test.before(async () => {
  PUERTO = await libre();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairos-pg-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: PUERTO, persistent: false });
  await pg.initialise(); await pg.start();
});
test.after(async () => {
  for (const c of conexiones) await c.end().catch(() => {});
  await pg.stop(); fs.rmSync(dir, { recursive: true, force: true });
});

test('01 y 03 se pueden ejecutar dos veces seguidas sin romper nada', async () => {
  const c = await baseNueva('idem');
  await c.query(SQL('01_esquema.sql')); await c.query(SQL('03_profesor_alumnos.sql'));
});

test.describe('04_latido.sql', () => {
  let c;
  test.before(async () => { c = await baseNueva('latido', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql']); });

  test('se puede repetir sin romper nada', async () => { await c.query(SQL('04_latido.sql')); });

  test('la web pública (anon) puede llamar a latido(); la primera vez escribe una fila', async () => {
    const r = await como(c, 'anon', 'select public.latido() as r');
    assert.deepEqual(r.rows[0].r, { ok: true, escrito: true });
    assert.equal((await c.query('select count(*)::int n from public.latidos')).rows[0].n, 1);
  });

  test('llamarla otra vez enseguida no escribe más (no se puede inflar la tabla)', async () => {
    for (let i = 0; i < 5; i++) assert.deepEqual((await como(c, 'anon', 'select public.latido() as r')).rows[0].r, { ok: true, escrito: false });
    assert.equal((await c.query('select count(*)::int n from public.latidos')).rows[0].n, 1);
  });

  test('anon no puede leer, escribir ni borrar la tabla latidos', async () => {
    for (const sql of ['select * from public.latidos', 'insert into public.latidos default values', 'delete from public.latidos', 'update public.latidos set momento = now()']) {
      await assert.rejects(como(c, 'anon', sql), /permission denied/, sql);
      await assert.rejects(como(c, 'authenticated', sql), /permission denied/, sql);
    }
  });

  test('pasada una hora vuelve a escribir y borra los latidos de más de 30 días', async () => {
    await c.query("insert into public.latidos(momento) values (now() - interval '31 days')");
    await c.query("update public.latidos set momento = now() - interval '2 hours' where momento > now() - interval '1 day'");
    const r = await como(c, 'anon', 'select public.latido() as r');
    assert.deepEqual(r.rows[0].r, { ok: true, escrito: true });
    const filas = (await c.query("select momento > now() - interval '30 days' as reciente from public.latidos")).rows;
    assert.equal(filas.length, 2);                       // la de hace 2 h y la nueva; la de 31 días se borró
    assert.ok(filas.every(f => f.reciente));
  });
});

test.describe('05_datos_prueba.sql', () => {
  test('crea 5 alumnos de prueba y sus códigos funcionan en entrar()', async () => {
    const c = await baseNueva('prueba', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '05_datos_prueba.sql']);
    assert.equal((await c.query("select count(*)::int n from public.alumnos where grupo='PRUEBA'")).rows[0].n, 5);
    const bien = await como(c, 'anon', "select public.entrar('AAA-222') as r");
    assert.deepEqual(bien.rows[0].r, { ok: true, alumno: 'PRUEBA-01', grupo: 'PRUEBA' });
    const sin = await como(c, 'anon', "select public.entrar('eee666') as r");   // minúsculas y sin guion también valen
    assert.equal(sin.rows[0].r.alumno, 'PRUEBA-05');
    const mal = await como(c, 'anon', "select public.entrar('ZZZ999') as r");
    assert.deepEqual(mal.rows[0].r, { ok: false, motivo: 'codigo' });
  });

  test('se puede repetir sin duplicar nada', async () => {
    const c = await conectar('prueba');
    await c.query(SQL('05_datos_prueba.sql'));
    assert.equal((await c.query("select count(*)::int n from public.alumnos")).rows[0].n, 5);
  });

  test('SEGURO: se niega a ejecutarse en una base con alumnos reales y no cambia nada', async () => {
    const c = await baseNueva('real');
    await c.query("insert into public.grupos(id, nombre) values ('TDA2','TDA II')");
    await c.query("insert into public.alumnos(id, grupo, codigo_hash) values ('TDA2-07','TDA2', public._hash_codigo('K7M4QX'))");
    await assert.rejects(c.query(SQL('05_datos_prueba.sql')), /alumnos reales/);
    assert.deepEqual((await c.query('select id from public.alumnos')).rows, [{ id: 'TDA2-07' }]);
    assert.equal((await c.query("select count(*)::int n from public.grupos where id='PRUEBA'")).rows[0].n, 0);
  });
});

test.describe('seguridad del esquema (sigue como antes)', () => {
  test('anon no lee ninguna tabla, pero entra y guarda con un código válido', async () => {
    const c = await conectar('prueba');
    for (const t of ['alumnos', 'intentos', 'grupos', 'profesores', 'accesos_fallidos', 'latidos'])
      await assert.rejects(como(c, 'anon', 'select * from public.' + t), /permission denied/, t);
    const datos = { test: 'x', version: 1, empezado: new Date().toISOString(), segundos: 5, total: 1, aciertos: 1, nota: 10, respuestas: [{ id: 'q1', elegida: 0, ok: true, ms: 100 }] };
    const r = await como(c, 'anon', 'select public.guardar_intento($1, $2::jsonb) as r', ['BBB333', JSON.stringify(datos)]);
    assert.deepEqual(r.rows[0].r, { ok: true });
    const mal = await como(c, 'anon', 'select public.guardar_intento($1, $2::jsonb) as r', ['ZZZ999', JSON.stringify(datos)]);
    assert.deepEqual(mal.rows[0].r, { ok: false, motivo: 'codigo' });
    assert.equal((await c.query("select count(*)::int n from public.intentos where alumno='PRUEBA-02'")).rows[0].n, 1);
  });
});
