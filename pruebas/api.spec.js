/* Pruebas de js/nucleo/api.js y de la elección de entorno (config.js).
   El cliente se prueba contra http://localhost (simulado): nunca contra Supabase. */
const { test, expect } = require('./fixtures');

const CFG = { supabaseUrl: 'http://localhost:4173', supabaseKey: 'clave-de-prueba' };

// Ejecuta `cuerpo(crearApi, ApiError)` dentro de la página y devuelve su resultado.
const enPagina = (page, cuerpo, arg) => page.evaluate(async ([c, a]) => {
  const m = await import('/js/nucleo/api.js');
  return await new Function('m', 'cfg', 'return (' + c + ')(m, cfg)')(m, a);
}, [cuerpo.toString(), arg]);

test.beforeEach(async ({ page }) => { await page.goto('test.html?modo=profe'); });

test.describe('api.rpc', () => {
  test('envía la clave y los argumentos y devuelve el JSON', async ({ page }) => {
    let visto;
    await page.route('http://localhost:4173/rest/v1/rpc/hola', r => {
      visto = { clave: r.request().headers()['apikey'], cuerpo: r.request().postDataJSON(), metodo: r.request().method() };
      r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    const res = await enPagina(page, async (m, cfg) => m.crearApi(cfg).rpc('hola', { a: 1 }), CFG);
    expect(res).toEqual({ ok: true });
    expect(visto).toEqual({ clave: 'clave-de-prueba', cuerpo: { a: 1 }, metodo: 'POST' });
  });

  test('error del servidor: ApiError «http» con su código y sin reintentar', async ({ page }) => {
    let n = 0;
    await page.route('http://localhost:4173/rest/v1/rpc/x', r => { n++; r.fulfill({ status: 500, body: '{}' }); });
    const e = await enPagina(page, async (m, cfg) => {
      try { await m.crearApi(cfg).rpc('x', {}, { reintentos: 3 }); } catch (e) { return { tipo: e.tipo, status: e.status, msg: e.message, esApiError: e instanceof m.ApiError }; }
    }, CFG);
    expect(e).toEqual({ tipo: 'http', status: 500, msg: 'HTTP 500', esApiError: true });
    expect(n).toBe(1);   // un 500 no se reintenta: podría haber escrito algo
  });

  test('sin reintentos por defecto: una caída de red falla a la primera', async ({ page }) => {
    let n = 0;
    await page.route('http://localhost:4173/rest/v1/rpc/x', r => { n++; r.abort(); });
    const tipo = await enPagina(page, async (m, cfg) => { try { await m.crearApi(cfg).rpc('x'); } catch (e) { return e.tipo; } }, CFG);
    expect(tipo).toBe('red');
    expect(n).toBe(1);
  });

  test('con reintentos: se repite si la red falla y acaba bien', async ({ page }) => {
    let n = 0;
    await page.route('http://localhost:4173/rest/v1/rpc/x', r => {
      n++; if (n < 2) return r.abort();
      r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    const res = await enPagina(page, async (m, cfg) => m.crearApi(cfg).rpc('x', {}, { reintentos: 2 }), CFG);
    expect(res).toEqual({ ok: true });
    expect(n).toBe(2);
  });

  test('con reintentos: un 503 se repite, pero se acaba rindiendo', async ({ page }) => {
    let n = 0;
    await page.route('http://localhost:4173/rest/v1/rpc/x', r => { n++; r.fulfill({ status: 503, body: '{}' }); });
    const e = await enPagina(page, async (m, cfg) => { try { await m.crearApi(cfg).rpc('x', {}, { reintentos: 1 }); } catch (e) { return e.status; } }, CFG);
    expect(e).toBe(503);
    expect(n).toBe(2);
  });

  test('si tarda demasiado: ApiError «tiempo»', async ({ page }) => {
    await page.route('http://localhost:4173/rest/v1/rpc/x', () => { /* no contesta nunca */ });
    const tipo = await enPagina(page, async (m, cfg) => { try { await m.crearApi(cfg, { tiempoMs: 300 }).rpc('x'); } catch (e) { return e.tipo; } }, CFG);
    expect(tipo).toBe('tiempo');
  });

  test('respuesta que no es JSON: ApiError «http»', async ({ page }) => {
    await page.route('http://localhost:4173/rest/v1/rpc/x', r => r.fulfill({ body: '<html>' }));
    const tipo = await enPagina(page, async (m, cfg) => { try { await m.crearApi(cfg).rpc('x'); } catch (e) { return e.tipo; } }, CFG);
    expect(tipo).toBe('http');
  });
});

test.describe('entorno (config.js)', () => {
  test('por defecto es producción', async ({ page }) => {
    expect(await page.evaluate(() => window.ENTORNO)).toBe('produccion');
    expect(await page.evaluate(() => window.CONFIG.supabaseUrl)).toContain('supabase.co');
  });

  test('?entorno=pruebas sin proyecto de pruebas configurado: sin conexión, nunca producción', async ({ page }) => {
    await page.goto('test.html?modo=profe&entorno=pruebas');
    expect(await page.evaluate(() => window.ENTORNO)).toBe('pruebas');
    expect(await page.evaluate(() => window.CONFIG)).toBeNull();
  });

  // Carga config.js (con un proyecto de pruebas de mentira, si se pide) bajo un nombre de host dado y devuelve el entorno resultante
  const entornoEn = (page, hostname, { pruebas = null } = {}) => page.evaluate(async ([host, prb]) => {
    let src = await (await fetch('/js/config.js')).text();
    if (prb) src = src.replace('pruebas: null', 'pruebas: ' + JSON.stringify(prb));
    const w = {}, avisos = [];
    const doc = { body: null, addEventListener() {}, createElement: () => ({ style: {} }) };
    new Function('window', 'location', 'URLSearchParams', 'console', 'document', src)(w, { hostname: host, search: '?entorno=pruebas' }, URLSearchParams,
      { warn: m => avisos.push(m), error: m => avisos.push(m) }, doc);
    return w.ENTORNO + '|' + (w.CONFIG ? w.CONFIG.supabaseUrl : 'sin-config') + '|' + avisos.length;
  }, [hostname, pruebas]);
  const PRB = { supabaseUrl: 'https://pruebas-de-mentira.supabase.co', supabaseKey: 'sb_publishable_PRUEBA' };

  test('el proyecto de pruebas se activa desde localhost y desde la red local (los móviles del ensayo), y solo desde ahí', async ({ page }) => {
    for (const host of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.16.3.4', '172.31.255.1', 'mi-mac.local'])
      expect(await entornoEn(page, host, { pruebas: PRB }), host).toBe('pruebas|' + PRB.supabaseUrl + '|0');
    for (const host of ['moliw4n.github.io', '8.8.8.8', '192.169.1.1', '172.32.0.1', '172.15.0.1', 'evil.com', '192.168.1.1.evil.com', '10.0.0.5.evil.com', 'localhost.evil.com', 'miorg.local.evil.com'])
      expect((await entornoEn(page, host, { pruebas: PRB })).startsWith('produccion|https://vltooganezktrqduwhzy'), host).toBe(true);
  });
  test('si por descuido el «proyecto de pruebas» es el de producción, no se conecta a nada', async ({ page }) => {
    const prod = await page.evaluate(() => window.CONFIG.supabaseUrl);
    expect(await entornoEn(page, 'localhost', { pruebas: { supabaseUrl: prod, supabaseKey: 'x' } })).toBe('pruebas|sin-config|2');   // dos avisos: «apunta a producción» y «no configurado»
  });
  test('fuera de localhost no se puede activar el entorno de pruebas', async ({ page }) => {
    // Se carga config.js bajo otro nombre de host simulando la web pública.
    const entorno = await page.evaluate(async () => {
      const src = await (await fetch('/js/config.js')).text();
      const fake = { hostname: 'moliw4n.github.io', search: '?entorno=pruebas' };
      const w = {};
      new Function('window', 'location', 'URLSearchParams', 'console', src)(w, fake, URLSearchParams, console);
      return w.ENTORNO + '|' + (w.CONFIG ? 'con-config' : 'sin-config');
    });
    expect(entorno).toBe('produccion|con-config');
  });
});
