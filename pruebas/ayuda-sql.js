/* Ayuda común de las pruebas de SQL: un Postgres REAL y LOCAL (embedded-postgres) en una carpeta temporal.
   Nunca toca Supabase. Simula lo que Supabase pone de serie:
     · los roles anon y authenticated, el esquema `extensions` y auth.jwt() (lee request.jwt.claims),
     · y los PRIVILEGIOS POR DEFECTO: en Supabase, todo lo que se crea en `public` se concede a anon y authenticated;
       por eso cada script tiene que hacer su `revoke`. Aquí también se conceden por defecto, para que a un script
       al que se le olvide el revoke le falle la prueba. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');

const SQL = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
const libre = () => new Promise((ok, mal) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => ok(p)); }); srv.on('error', mal); });

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
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

let pg, dir, PUERTO;
const conexiones = [];

async function iniciar() {
  PUERTO = await libre();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiron-pg-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: PUERTO, persistent: false });
  await pg.initialise(); await pg.start();
}
async function parar() {
  for (const c of conexiones) await c.end().catch(() => {});
  await pg.stop(); fs.rmSync(dir, { recursive: true, force: true });
}
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
// Como una persona con sesión iniciada (Supabase Auth) con ese correo: rol authenticated + su JWT.
async function comoUsuario(c, email, sql, params) {
  await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ email })]);
  try { return await como(c, 'authenticated', sql, params); }
  finally { await c.query("select set_config('request.jwt.claims', '', false)"); }
}

module.exports = { SQL, iniciar, parar, conectar, baseNueva, como, comoUsuario };
