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
const { crearServidorDirecto } = require('./servidor-directo-falso');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'simular-clase.mjs');
const CLAVE = 'sb_publishable_PRUEBA_LOCAL';
let S, servidor, puerto, tmp, banco, estado, Dd = null;
const gancho = { fuga: null, soluciones: false, directo: null };

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
      if (rpc && req.method === 'POST' && rpc[1] === 'entrar') {              // como entrar() del SQL real
        const cod = JSON.parse(cuerpo || '{}').p_codigo, k = ['AAA222', 'BBB333', 'CCC444', 'DDD555', 'EEE666'].indexOf(cod);
        return enviar(200, k < 0 ? { ok: false, motivo: 'codigo' } : { ok: true, alumno: 'PRUEBA-0' + (k + 1), grupo: 'PRUEBA' });
      }
      if (rpc && req.method === 'POST' && rpc[1] === 'latido') return enviar(200, { ok: true, escrito: false });
      if (rpc && req.method === 'POST' && Dd && ['directo_unirse', 'directo_estado', 'directo_responder'].includes(rpc[1])) {     // las funciones del directo, con un gancho para provocar fallos
        const r = Dd.llamar(rpc[1], JSON.parse(cuerpo || '{}'));
        return enviar(200, gancho.directo ? gancho.directo(rpc[1], r) : r);
      }
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

test.describe('comprobación rápida (fase base)', () => {
  const base = () => lanzar(['base', '--url', URL_LOCAL(), '--key', CLAVE]);
  test('con el servidor bien montado, todo sale en verde', async () => {
    await crear();
    const r = await base();
    assert.equal(r.codigo, 0, r.salida); assert.match(r.salida, /Todo correcto/);
    for (const k of [1, 2, 3, 4, 5]) assert.match(r.salida, new RegExp('✓ el código de prueba ' + k + ' entra como PRUEBA-0' + k));
    assert.match(r.salida, /✓ un código que no existe se rechaza/); assert.match(r.salida, /✓ latido\(\) responde ok/); assert.match(r.salida, /✓ mis_juegos responde/);
  });
  test('si una tabla se puede leer desde fuera, lo dice', async () => {
    await crear(); gancho.fuga = 'alumnos';
    const r = await base();
    assert.equal(r.codigo, 1, r.salida); assert.match(r.salida, /tabla «alumnos»: la web pública no puede leerla/);
  });
  test('no hace falta ningún examen ni ningún banco', async () => {
    await crear();
    assert.equal((await base()).codigo, 0);
    assert.equal(S.partidas.length, 0);
  });
  test('también tiene las guardas: producción y otras direcciones, rechazadas', async () => {
    const prod = fs.readFileSync(path.join(RAIZ, 'js', 'config.js'), 'utf8').match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
    assert.match((await lanzar(['base', '--url', prod, '--key', CLAVE])).salida, /PRODUCCIÓN/);
    assert.match((await lanzar(['base', '--url', 'https://evil.com', '--key', CLAVE])).salida, /Solo se admite/);
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

test.describe('directo: una clase de hasta 25 alumnos', () => {
  const pausa = ms => new Promise(r => setTimeout(r, ms));
  // 25 alumnos de prueba (los 5 de siempre y LOAD06…LOAD25), todos del grupo de la sala
  const alumnos25 = () => Object.fromEntries([['AAA222', 1], ['BBB333', 2], ['CCC444', 3], ['DDD555', 4], ['EEE666', 5], ...Array.from({ length: 20 }, (_, k) => ['LOAD' + String(k + 6).padStart(2, '0'), k + 6])]
    .map(([cod, n]) => [cod, { id: 'PRUEBA-' + String(n).padStart(2, '0'), grupo: 'TDA2' }]));
  const sala = async (preguntas = ['t1mc', 't1vf', 't2mc'], tiempoS = 4) => { gancho.directo = null; Dd = await crearServidorDirecto({ preguntas, tiempoS, alumnos: alumnos25() }); };
  // El «profesor»: espera a que entren todos, empieza, cierra cada pregunta y pasa a la siguiente, hasta el final
  const conducir = async (n, preguntas = 3, yaDentro = 0, cierre = 3500) => {
    while (Dd.participantes.length < n + yaDentro) await pausa(40);
    await pausa(250); Dd.avanzar();
    for (let q = 0; q < preguntas; q++) { await pausa(cierre); Dd.avanzar(); await pausa(450); Dd.avanzar(); }
  };
  const directo = (n, extra = []) => lanzar(['directo', '--url', URL_LOCAL(), '--key', CLAVE, '--sala', Dd ? Dd.sala : '123456', '--alumnos', String(n), '--sondeo', '90', '--maximo', '1', ...extra]);
  const clase = async (n, preguntas = 3, yaDentro = 0, cierre = 3500) => { const [r] = await Promise.all([directo(n), conducir(n, preguntas, yaDentro, cierre)]); return r; };

  test('25 alumnos juegan a la vez: todo cuadra y el informe mide el tráfico', async () => {
    await sala();
    const r = await clase(25);
    assert.equal(r.codigo, 0, r.salida);
    assert.match(r.salida, /25 de 25 alumnos dentro de la sala/); assert.match(r.salida, /todos los apodos son distintos/); assert.match(r.salida, /25 de 25 alumnos llegaron al final/);
    assert.match(r.salida, /ninguna solución llegó al móvil antes de tiempo/); assert.match(r.salida, /PICO \d+ en un solo segundo/); assert.match(r.salida, /directo_estado/); assert.match(r.salida, /ninguna petición falló/);
    assert.match(r.salida, /Todo correcto/);
    assert.equal(Dd.participantes.length, 25); assert.equal(Dd.estado, 'terminada');
    assert.ok(Dd.respuestas.length > 25, 'respuestas ' + Dd.respuestas.length);
    const porAlumno = {}; for (const x of Dd.respuestas) porAlumno[x.alumno] = (porAlumno[x.alumno] || 0) + x.puntos;
    for (const p of Dd.participantes) assert.equal(p.puntos, porAlumno[p.alumno] || 0, p.alumno);       // los puntos de cada uno son la suma de sus respuestas
    assert.match(r.salida, /se le cae la red/); assert.match(r.salida, /recarga y conserva su apodo/);
  });
  test('«--alumnos» más pequeño, y los de relleno que ya estaban en la sala no estorban', async () => {
    await sala(); Dd.sembrar([300, 100]);
    const r = await clase(4, 3, 2);
    assert.equal(r.codigo, 0, r.salida); assert.match(r.salida, /4 de 4 alumnos dentro/);
  });
  test('una sala que no existe: lo dice y falla', async () => {
    await sala();
    const r = await lanzar(['directo', '--url', URL_LOCAL(), '--key', CLAVE, '--sala', '999999', '--alumnos', '3', '--sondeo', '90']);
    assert.equal(r.codigo, 1, r.salida); assert.match(r.salida, /no existe, ya terminó o no es del grupo/);
  });
  test('sin --sala explica qué falta; con el servidor de producción se niega', async () => {
    const r = await lanzar(['directo', '--url', URL_LOCAL(), '--key', CLAVE]);
    assert.equal(r.codigo, 2); assert.match(r.salida, /Falta --sala/);
    const prod = fs.readFileSync(path.join(RAIZ, 'js', 'config.js'), 'utf8').match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
    const r2 = await lanzar(['directo', '--url', prod, '--key', CLAVE, '--sala', '123456']);
    assert.notEqual(r2.codigo, 0); assert.match(r2.salida, /PRODUCCIÓN/);
  });
  test('alumnos que el servidor no conoce (falta 10_alumnos_carga.sql): lo explica', async () => {
    await sala(); Dd.alumnos = { AAA222: { id: 'PRUEBA-01', grupo: 'TDA2' } };
    const r = await lanzar(['directo', '--url', URL_LOCAL(), '--key', CLAVE, '--sala', Dd.sala, '--alumnos', '3', '--sondeo', '90']);
    assert.equal(r.codigo, 1, r.salida); assert.match(r.salida, /10_alumnos_carga\.sql/);
  });

  test.describe('SABE DETECTAR los fallos del servidor (cada uno provocado a propósito)', () => {
    const con = async (hook, esperado) => {
      await sala(['t1mc', 't1vf'], 2); gancho.directo = hook;          // sala corta (2 preguntas de 2 s) para que cada fallo provocado tarde poco
      const r = await clase(6, 2, 0, 1800);
      gancho.directo = null;
      assert.equal(r.codigo, 1, 'debería haber fallado:\n' + r.salida); assert.match(r.salida, esperado, r.salida);
    };
    test('el resultado trae «la trampa» de la pregunta al móvil', () => con((fn, r) => { if (fn === 'directo_estado' && r.resultado) r.resultado.trampa = 'LA TRAMPA'; return r; }, /manda «trampa» al móvil/));
    test('el servidor cuela la solución con la pregunta abierta', () => con((fn, r) => { if (fn === 'directo_estado' && r.pregunta) r.pregunta.sol = 'LA SOLUCIÓN'; return r; }, /campos que no son de la lista blanca: sol/));
    test('la solución aparece fuera del resultado', () => con((fn, r) => { if (fn === 'directo_estado' && r.pregunta) r.sol = 'x'; return r; }, /manda «sol» fuera del resultado/));
    test('responder dice si acertó', () => con((fn, r) => (fn === 'directo_responder' && r.ok ? { ...r, acerto: true } : r), /dice si acertó/));
    test('el reparto de lo que contestaron los demás llega al móvil', () => con((fn, r) => { if (fn === 'directo_estado' && r.resultado) r.resultado.reparto = [{ texto: 'x', veces: 3 }]; return r; }, /manda «reparto» al móvil/));
    test('acertar da más de 1000 puntos', () => con((fn, r) => { if (fn === 'directo_estado' && r.resultado && r.resultado.ok) r.resultado.puntos = 1500; return r; }, /acertó y le dan 1500 puntos/));
    test('fallar o no contestar da puntos', () => con((fn, r) => { if (fn === 'directo_estado' && r.resultado && !r.resultado.ok) r.resultado.puntos = 200; return r; }, /(no contestó|falló) y (tiene|le dan) 200 puntos/));
    test('se pierde una respuesta ya confirmada', () => con((fn, r) => { if (fn === 'directo_responder' && r.ok) Dd.respuestas.pop(); return r; }, /confirmó su respuesta .* pero luego dice que no contestó/));
    test('contestar dos veces no se rechaza', () => con((fn, r) => (fn === 'directo_responder' && r.motivo === 'ya_respondida' ? { ok: true } : r), /contestar dos veces la misma pregunta no fue rechazado/));
    test('dos alumnos con el mismo apodo', () => con((fn, r) => (fn === 'directo_unirse' && r.ok ? { ...r, apodo: 'Zorro Azul' } : r), /apodos son distintos/));
    test('el marcador viene desordenado', () => con((fn, r) => { if (fn === 'directo_estado' && r.marcador) r.marcador = [...r.marcador].reverse(); return r; }, /marcador no está ordenado/));
    test('la posición final no es la que toca', () => con((fn, r) => { if (fn === 'directo_estado' && r.estado === 'terminada') r.posicion = 1; return r; }, /su posición final es 1/));
  });
});
