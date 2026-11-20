/* Contrato de los modos de juego (js/nucleo/modos.js) y modo `practica`. */
const { test, expect, contestar } = require('./fixtures');

// Test mínimo para jugar el modo a mano dentro de una página que no arranca ningún modo.
const MINI = { id: 'mini', titulo: 'Mini · Prueba', materia: 'TDA II', version: 1, preguntas: [
  { id: 'a', tipo: 'imprime', enun: 'A', ops: ['1', '2', '3', '4'], ok: 0, sol: 's', trampa: 't', criterio: '2.1' },
  { id: 'b', tipo: 'imprime', enun: 'B', ops: ['1', '2', '3', '4'], ok: 1, sol: 's', trampa: 't', criterio: '2.1' },
  { id: 'c', tipo: 'error', enun: 'C', ops: ['1', '2', '3', '4'], ok: 2, sol: 's', trampa: 't', criterio: '2.2' }
] };

test.beforeEach(async ({ page }) => { await page.goto('test.html?t=no-existe'); });   // página sin ningún modo en marcha

test.describe('contrato', () => {
  test('el modo práctica cumple el contrato', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { cargarModo } = await import('/js/nucleo/modos.js');
      const m = await cargarModo('practica');
      return { id: m.id, nombre: m.nombre, necesita: m.necesita, tipos: m.tiposPregunta, iniciar: typeof m.iniciar, terminar: typeof m.terminar };
    });
    expect(r).toEqual({ id: 'practica', nombre: 'Práctica', necesita: { directo: false, servidor: true }, tipos: ['opcion_multiple'], iniciar: 'function', terminar: 'function' });
  });

  test('un modo que no cumple el contrato se rechaza con un motivo claro', async ({ page }) => {
    const errores = await page.evaluate(async () => {
      const { validarModo } = await import('/js/nucleo/modos.js');
      const bueno = { id: 'x', nombre: 'X', necesita: {}, tiposPregunta: ['opcion_multiple'], iniciar() {}, terminar() {} };
      const intenta = m => { try { validarModo(m, 'x'); return 'ok'; } catch (e) { return e.message; } };
      return [intenta(bueno), intenta({ ...bueno, id: 'otro' }), intenta({ ...bueno, iniciar: null }), intenta({ ...bueno, tiposPregunta: [] }), intenta(null)];
    });
    expect(errores[0]).toBe('ok');
    expect(errores[1]).toContain('no coincide con la carpeta');
    expect(errores[2]).toContain('falta iniciar()');
    expect(errores[3]).toContain('falta tiposPregunta');
    expect(errores[4]).toContain('no exporta un objeto');
  });

  test('un id de modo raro no se carga (no se puede importar cualquier ruta)', async ({ page }) => {
    const msg = await page.evaluate(async () => {
      const { cargarModo } = await import('/js/nucleo/modos.js');
      try { await cargarModo('../../config'); } catch (e) { return e.message; }
    });
    expect(msg).toContain('Modo no válido');
  });

  test('un modo que no existe da error, no se queda colgado', async ({ page }) => {
    const ok = await page.evaluate(async () => {
      const { cargarModo } = await import('/js/nucleo/modos.js');
      try { await cargarModo('no-existe'); return false; } catch (e) { return true; }
    });
    expect(ok).toBe(true);
  });

  test('un test que pide un modo inexistente muestra un mensaje amable', async ({ page }) => {
    await page.route('**/tests/pide-modo.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...MINI, modo: 'no-existe' }) }));
    await page.goto('test.html?t=pide-modo&modo=profe');
    await expect(page.locator('#escena')).toContainText('necesita algo que todavía no está disponible');
  });

  test('un test con "modo": "practica" funciona igual que sin él', async ({ page }) => {
    await page.route('**/tests/con-modo.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...MINI, modo: 'practica' }) }));
    await page.goto('test.html?t=con-modo&modo=profe');
    await expect(page.locator('#bEmpezar')).toBeVisible();
  });
});

test.describe('resultado normalizado', () => {
  async function jugarMini(page, aciertos) {
    await page.evaluate(async T => {
      const { cargarModo } = await import('/js/nucleo/modos.js');
      const m = await cargarModo('practica');
      window.__modo = m;
      window.__ctx = { alumno: { codigo: 'ABC123', alumno: 'TDA2-07', grupo: 'TDA2' }, juego: null, contenido: T,
        api: { rpc: async () => ({ ok: true }) }, nucleo: {}, contenedor: document.querySelector('#escena'),
        chuleta: null, modoProfe: false, temaActual: () => null, salir: () => {} };
      await m.iniciar(window.__ctx);
    }, MINI);
    await page.click('#bEmpezar');
    for (let i = 0; i < MINI.preguntas.length; i++) {
      await contestar(page, MINI, i < aciertos);
      if (i < MINI.preguntas.length - 1) await page.click('#bSig');
    }
    return page.evaluate(() => window.__modo.terminar());
  }

  test('tiene la forma común: partida, alumno, juego, nota, puntos, segundos, por_criterio, respuestas', async ({ page }) => {
    const r = await jugarMini(page, 3);
    expect(Object.keys(r).sort()).toEqual(['alumno', 'juego', 'nota', 'partida', 'por_criterio', 'puntos', 'respuestas', 'segundos']);
    expect(r).toMatchObject({ partida: null, alumno: 'TDA2-07', juego: 'mini', nota: 10, puntos: 0 });
    expect(Number.isInteger(r.segundos)).toBe(true);
    expect(r.por_criterio).toEqual({ '2.1': 1, '2.2': 1 });
    expect(r.respuestas.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  test('la nota sale de aciertos/total y los criterios reflejan los fallos', async ({ page }) => {
    const r = await jugarMini(page, 1);   // solo acierta la 1.ª (criterio 2.1); falla b (2.1) y c (2.2)
    expect(r.nota).toBe(3.3);
    expect(r.por_criterio).toEqual({ '2.1': 0.5, '2.2': 0 });
  });

  test('terminar() quita el teclado: tras terminar, pulsar 1 ya no responde', async ({ page }) => {
    test.skip(test.info().project.name === 'movil', 'el teclado es de escritorio');
    await page.evaluate(async T => {
      const m = (await import('/js/nucleo/modos.js')); const modo = await m.cargarModo('practica'); window.__modo = modo;
      await modo.iniciar({ alumno: null, juego: null, contenido: T, api: { rpc: async () => ({}) }, nucleo: {}, contenedor: document.querySelector('#escena'), chuleta: null, modoProfe: true, temaActual: () => null, salir() {} });
    }, MINI);
    await page.click('#bEmpezar');
    await page.evaluate(() => window.__modo.terminar());
    await page.keyboard.press('1');
    await expect(page.locator('.q')).not.toHaveClass(/resuelta/);
  });
});
