/* Prueba .github/scripts/latido.sh contra un servidor simulado en local. Nunca llama a Supabase. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '.github', 'scripts', 'latido.sh');
let servidor, puerto, visto, respuesta;

test.before(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', d => cuerpo += d);
    req.on('end', () => {
      visto = { metodo: req.method, ruta: req.url, apikey: req.headers.apikey, cuerpo };
      res.writeHead(respuesta.status, { 'Content-Type': 'application/json' }); res.end(respuesta.body);
    });
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  puerto = servidor.address().port;
});
test.after(() => servidor.close());

// spawn (asíncrono): el servidor simulado vive en este mismo proceso y tiene que poder contestar mientras corre el script.
const lanzar = env => new Promise(resolve => {
  const p = spawn('bash', [SCRIPT], { env: { PATH: process.env.PATH, ...env } });
  let salida = ''; p.stdout.on('data', d => salida += d); p.stderr.on('data', d => salida += d);
  p.on('close', status => resolve({ status, salida }));
});
const CON = { LATIDO_URL: () => 'http://127.0.0.1:' + puerto, LATIDO_KEY: () => 'sb_publishable_CLAVEDEPRUEBA' };
const lanzarCon = extra => lanzar({ LATIDO_URL: CON.LATIDO_URL(), LATIDO_KEY: CON.LATIDO_KEY(), ...extra });

test('latido ok: llama a /rest/v1/rpc/latido con la clave y termina bien', async () => {
  respuesta = { status: 200, body: '{"ok": true, "escrito": true}' };
  const r = await lanzarCon();
  assert.equal(r.status, 0, r.salida);
  assert.deepEqual(visto, { metodo: 'POST', ruta: '/rest/v1/rpc/latido', apikey: 'sb_publishable_CLAVEDEPRUEBA', cuerpo: '{}' });
});

test('también vale cuando no escribe (ya había un latido reciente)', async () => {
  respuesta = { status: 200, body: '{"ok":true,"escrito":false}' };
  assert.equal((await lanzarCon()).status, 0);
});

test('falla si la función no existe (404), si hay error del servidor o si no dice ok', async () => {
  for (const [status, body] of [[404, '{"message":"not found"}'], [500, '{}'], [200, '{"ok": false}'], [200, '<html>'], [200, '{}']]) {
    respuesta = { status, body };
    const r = await lanzarCon();
    assert.notEqual(r.status, 0, status + ' ' + body);
  }
});

test('no escribe la clave en la salida', async () => {
  respuesta = { status: 200, body: '{"ok": true}' };
  const r = await lanzarCon();
  assert.ok(!r.salida.includes('CLAVEDEPRUEBA'));
});

test('si no hay URL o clave en la configuración, falla con un mensaje claro', async () => {
  const vacio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'latido-')), 'config.js');
  fs.writeFileSync(vacio, '// sin nada');
  const r = await lanzar({ LATIDO_CONFIG: vacio });
  assert.notEqual(r.status, 0);
  assert.match(r.salida, /No encuentro la URL o la clave/);
});

test('lee de js/config.js la URL y la clave de PRODUCCIÓN (la primera que aparece)', async () => {
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'latido-')), 'config.js');
  fs.writeFileSync(cfg, `produccion: { supabaseUrl: 'https://aaaaprod.supabase.co', supabaseKey: 'sb_publishable_PROD' },\n pruebas: { supabaseUrl: 'https://bbbbtest.supabase.co', supabaseKey: 'sb_publishable_TEST' }`);
  const r = await lanzar({ LATIDO_CONFIG: cfg, LATIDO_SIMULACRO: '1' });   // simulacro: no llama a nadie
  assert.equal(r.status, 0, r.salida);
  assert.match(r.salida, /Latido a https:\/\/aaaaprod\.supabase\.co/);   // elige producción, no pruebas
  assert.doesNotMatch(r.salida, /bbbbtest/);
});

test('el js/config.js real tiene una URL y una clave publishable que el script sabe leer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  assert.match(src, /https:\/\/[a-z0-9]+\.supabase\.co/);
  assert.match(src, /sb_publishable_[A-Za-z0-9_-]+/);
});
