/* El simulador de clase (scripts/simular-clase.mjs) funciona y SABE DETECTAR los problemas. Se prueba contra un servidor local que imita a
   Supabase (con el servidor falso del examen). Nunca se conecta a nada de internet. Se ejecuta con: npm run test:simulador */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { crearServidorFalso, bancoDePrueba } = require('./servidor-examen-falso');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'simular-clase.mjs');
const CLAVE = 'sb_publishable_PRUEBA_LOCAL';
let S, servidor, puerto, tmp, banco, estado;
const gancho = { fuga: null, soluciones: false };

const crear = async () => {
  S = await crearServidorFalso({ reglas: { preguntas: 12 }, alumnos: { CCC444: { id: 'TDA2-03', grupo: 'TDA2' }, DDD555: { id: 'TDA2-04', grupo: 'TDA2' }, EEE666: { id: 'TDA2-05', grupo: 'TDA2' } } });   // los 5 de prueba, todos del mismo grupo
  gancho.fuga = null; gancho.soluciones = false;
};
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simulador-')); banco = path.join(tmp, 'banco.json'); estado = path.join(tmp, 'estado.json');
  fs.writeFileSync(banco, JSON.stringify(bancoDePrueba()));
  await crear();
  servidor = http.createServer((req, res) => {
    let cuerpo = ''; req.on('data', d => cuerpo += d);
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), enviar = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.apikey !== CLAVE) return enviar(401, { message: 'Invalid API key' });
      const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      if (rpc && req.method === 'POST') {
        const r = S.llamar(rpc[1], JSON.parse(cuerpo || '{}'));
        if (r === null) return enviar(403, { code: '42501', message: 'permission denied for function ' + rpc[1] });       // profe_* e internas: no están al alcance de la web pública
        if (gancho.soluciones && rpc[1] === 'empezar_partida' && r.items) r.items.forEach(i => { i.sol = 'LA SOLUCIÓN'; });  // fallo simulado: se cuela una solución
        return enviar(200, r);
      }
      const tabla = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
      if (tabla) { if (gancho.fuga === tabla[1] && req.method === 'GET') return enviar(200, [{ id: 'dato que no debería verse' }]); return enviar(401, { code: '42501', message: 'permission denied for table ' + tabla[1] }); }
      enviar(404, {});
    });
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r)); puerto = servidor.address().port;
});
test.after(() => { servidor.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const URL_LOCAL = () => 'http://127.0.0.1:' + puerto;
const lanzar = (args) => new Promise(resolve => {
  const p = spawn('node', [SCRIPT, ...args], { cwd: RAIZ, env: { PATH: process.env.PATH } });
  let salida = ''; p.stdout.on('data', d => salida += d); p.stderr.on('data', d => salida += d);
  p.on('close', codigo => resolve({ codigo, salida }));
});
const jugar = (extra = []) => lanzar(['jugar', '--url', URL_LOCAL(), '--key', CLAVE, '--juego', 'ex', '--banco', banco, '--estado', estado, ...extra]);
const comprobar = () => lanzar(['comprobar', '--url', URL_LOCAL(), '--key', CLAVE, '--estado', estado]);

test.describe('guardas: nunca se conecta a donde no debe', () => {
  test('la URL de producción se rechaza sin hacer nada', async () => {
    const prod = fs.readFileSync(path.join(RAIZ, 'js', 'config.js'), 'utf8').match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
    const r = await lanzar(['jugar', '--url', prod, '--key', CLAVE, '--juego', 'x', '--banco', banco]);
    assert.notEqual(r.codigo, 0); assert.match(r.salida, /PRODUCCIÓN/);
    const r2 = await lanzar(['jugar', '--url', prod + '/', '--key', CLAVE, '--juego', 'x', '--banco', banco]);     // con barra final también
    assert.match(r2.salida, /PRODUCCIÓN/);
  });
  test('una dirección que no es localhost ni *.supabase.co se rechaza', async () => {
    for (const u of ['https://evil.com', 'https://supabase.co.evil.com', 'http://192.168.1.5:3000']) {
      const r = await lanzar(['jugar', '--url', u, '--key', CLAVE, '--juego', 'x', '--banco', banco]);
      assert.notEqual(r.codigo, 0, u); assert.match(r.salida, /Solo se admite/, u);
    }
  });
  test('una clave secreta o que no es publishable se rechaza', async () => {
    for (const k of ['sb_secret_abc123', 'service_role_xyz', 'cualquiercosa']) {
      const r = await lanzar(['jugar', '--url', 'https://abcdefgh.supabase.co', '--key', k, '--juego', 'x', '--banco', banco]);
      assert.notEqual(r.codigo, 0, k); assert.match(r.salida, /clave|publishable|secret/i, k);
    }
  });
  test('sin argumentos explica cómo se usa', async () => {
    const r = await lanzar([]); assert.equal(r.codigo, 2); assert.match(r.salida, /Uso:/);
  });
});

test.describe('una clase completa', () => {
  test('juegan 5 alumnos, todo se comprueba bien, y las notas se verifican tras publicarlas', async () => {
    await crear();
    const r = await jugar();
    assert.equal(r.codigo, 0, r.salida);
    assert.match(r.salida, /Todo correcto/);
    assert.match(r.salida, /\[perfecto\] esperado: nota 10,00/);
    assert.equal(S.partidas.length, 5);
    assert.ok(S.partidas.every(p => p.estado === 'entregada'));
    const est = JSON.parse(fs.readFileSync(estado, 'utf8'));
    assert.deepEqual(est.alumnos.map(a => a.perfil), ['perfecto', 'notable', 'justo', 'flojo', 'en blanco']);
    assert.deepEqual(est.alumnos.map(a => a.nota), [10, 8.33, 5, 1.67, 0]);                   // 12 preguntas: 12/12 · 10/12 · 6/12 · 2/12 · 0
    // lo que ve el servidor coincide con lo que el simulador esperaba (la nota la calcula el servidor falso con la misma regla que el SQL)
    for (const [i, a] of est.alumnos.entries()) assert.equal(S.partidas[i].aciertos, a.aciertos, a.perfil);
    assert.equal(S.eventos.filter(e => e.tipo === 'salida').length, 3);              // notable 2 + justo 1
    // antes de publicar: pendiente (código 2)
    const antes = await comprobar();
    assert.equal(antes.codigo, 2, antes.salida); assert.match(antes.salida, /aún no está publicada/);
    S.publicarNotas(true);
    const despues = await comprobar();
    assert.equal(despues.codigo, 0, despues.salida); assert.match(despues.salida, /Todo correcto/);
    for (const a of est.alumnos) assert.match(despues.salida, new RegExp(a.perfil + ': nota ' + String(S.partidas[est.alumnos.indexOf(a)].nota).replace('.', ',')));
  });
  test('si una nota del servidor no cuadra con lo esperado, lo detecta', async () => {
    await crear(); await jugar(); S.publicarNotas(true);
    S.partidas[1].nota = 9;
    const r = await comprobar();
    assert.equal(r.codigo, 1, r.salida); assert.match(r.salida, /PROBLEMA/); assert.match(r.salida, /notable/);
  });
  test('repetir el ensayo sobre una partida ya hecha lo avisa en vez de duplicar', async () => {
    await crear(); await jugar();
    const r = await jugar();
    assert.equal(r.codigo, 1); assert.match(r.salida, /ya tenía una partida/);
    assert.equal(S.partidas.length, 5);
  });
  test('un examen que no está asignado al grupo: lo dice', async () => {
    await crear();
    const r = await lanzar(['jugar', '--url', URL_LOCAL(), '--key', CLAVE, '--juego', 'no-existe', '--banco', banco, '--estado', estado]);
    assert.equal(r.codigo, 1); assert.match(r.salida, /no tiene asignado el examen «no-existe»/);
  });
});

test.describe('detecta los fallos de seguridad del servidor', () => {
  test('una solución colada en las preguntas', async () => {
    await crear(); gancho.soluciones = true;
    const r = await jugar();
    assert.equal(r.codigo, 1, r.salida); assert.match(r.salida, /ninguna pregunta trae ok, valor ni respuestas|sol/);
  });
  test('una tabla que se puede leer desde fuera', async () => {
    await crear(); gancho.fuga = 'partidas';
    const r = await jugar();
    assert.equal(r.codigo, 1, r.salida); assert.match(r.salida, /tabla «partidas»: la web pública no puede leerla/);
  });
  test('si todo está bien cerrado, las comprobaciones de seguridad salen en verde', async () => {
    await crear();
    const r = await jugar();
    for (const t of ['alumnos', 'partidas', 'items', 'respuestas', 'profesores']) assert.match(r.salida, new RegExp('✓ tabla «' + t + '»'));
    for (const f of ['profe_resultados', 'profe_publicar_notas', '_corregir_item']) assert.match(r.salida, new RegExp('✓ «' + f + '»'));
  });
});
