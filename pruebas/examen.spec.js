/* El modo EXAMEN en la web (jugar.html?j=ex), a 1280 y a 390 px. El servidor es el falso de pruebas/servidor-examen-falso.js,
   que responde con la misma forma que el SQL real (lo comprueba pruebas/contrato-examen.test.js). */
const { test, expect, entrar } = require('./fixtures');
const { crearServidorFalso } = require('./servidor-examen-falso');

const IDS = ['t1mc', 't1vf', 't1n', 't2c', 't1fija'];        // opción múltiple, V/F, numérica, respuesta corta, opción múltiple con «Ninguna…» fija
const movil = () => test.info().project.name === 'movil';
const sinDesborde = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

async function abrir(page, servidor, { ids = IDS, reglas = {}, asignacion = {}, ajustes = null, entrarYa = true } = {}) {
  servidor.examen = await crearServidorFalso({ ids, reglas: { preguntas: ids ? ids.length : 6, ...reglas }, asignacion });
  if (ajustes) await page.addInitScript(a => { window.KIRON_AJUSTES = a; }, ajustes);
  await page.goto('jugar.html?j=ex');
  if (entrarYa) await entrar(page);
  return servidor.examen;
}
async function empezar(page, servidor, opciones) {
  const S = await abrir(page, servidor, opciones);
  await page.click('#bEmpezar');
  await expect(page.locator('.q.en-examen')).toBeVisible();
  return S;
}
const opcion = (page, texto) => page.locator('.q.en-examen .op', { hasText: texto });
const escribir = async (page, texto) => { await page.fill('.resp-escrita input', texto); await page.press('.resp-escrita input', 'Enter'); };
const siguiente = page => page.click('#bSig');
// Avanza hasta la última pregunta y pulsa «Revisar y entregar»
const aRevisar = async page => { while ((await page.locator('#bSig').textContent()).includes('Siguiente')) await siguiente(page); await siguiente(page); };

test.describe('acceso y portada', () => {
  test('se abre con ?j=, pide el código (aunque se ponga modo=profe) y enseña las reglas', async ({ page, servidor }) => {
    servidor.examen = await crearServidorFalso({ ids: IDS, reglas: { preguntas: 5 } });
    await page.goto('jugar.html?j=ex&modo=profe');
    await expect(page.locator('#iCodigo')).toBeVisible();                                   // sin código no se entra, ni siquiera de profe
    await expect(page.locator('.aviso-profe')).toHaveCount(0);
    await entrar(page);
    await expect(page.locator('.portada h1')).toContainText('Examen de prueba');
    await expect(page.locator('.reglas-examen')).toContainText('5 preguntas y 20 minutos');
    await expect(page.locator('.reglas-examen')).toContainText('Solo tienes un intento');
    await expect(page.locator('.reglas-examen')).toContainText('No verás si aciertas');
    await expect(page.locator('.quien')).toContainText('nº 07');
    await expect(page.locator('#bEmpezar')).toHaveText('Empezar el examen →');
    await expect(page).toHaveTitle(/Examen de prueba · Kiron/);
    await sinDesborde(page);
  });
  test('el singular está bien dicho: «1 pregunta y 1 minuto»', async ({ page, servidor }) => {
    servidor.examen = await crearServidorFalso({ ids: ['t1mc'], reglas: { preguntas: 1, tiempo_min: 1 } });
    await page.goto('jugar.html?j=ex'); await entrar(page);
    await expect(page.locator('.reglas-examen li').first()).toContainText('1 pregunta y 1 minuto.');
  });
  test('un examen que no es de tu grupo: mensaje claro', async ({ page, servidor }) => {
    await abrir(page, servidor, { asignacion: { grupo: 'TDA1' } });
    await expect(page.locator('#escena')).toContainText('No tienes asignado este examen');
    await page.click('#bSalirJuego');
    await expect(page.locator('#iCodigo')).toBeVisible();
  });
  test('un id de examen que no existe: mismo mensaje', async ({ page, servidor }) => {
    servidor.examen = await crearServidorFalso({ ids: IDS });
    await page.goto('jugar.html?j=otro'); await entrar(page);
    await expect(page.locator('#escena')).toContainText('No tienes asignado este examen');
  });
  test('todavía no abierto: dice cuándo y no deja empezar', async ({ page, servidor }) => {
    await abrir(page, servidor, { asignacion: { desde: Date.now() + 3600e3 } });
    await expect(page.locator('#estadoExamen')).toContainText('Todavía no está abierto');
    await expect(page.locator('#bEmpezar')).toHaveCount(0);
  });
  test('ya cerrado: no deja empezar', async ({ page, servidor }) => {
    await abrir(page, servidor, { asignacion: { hasta: Date.now() - 60e3 } });
    await expect(page.locator('#estadoExamen')).toContainText('ya está cerrado');
    await expect(page.locator('#bEmpezar')).toHaveCount(0);
  });
  test('sin conexión al buscar el examen: avisa y deja reintentar', async ({ page, servidor }) => {
    servidor.examen = await crearServidorFalso({ ids: IDS });
    await page.goto('jugar.html?j=ex');
    servidor.examen.red = false; await entrar(page);
    await expect(page.locator('#escena')).toContainText('No hay conexión');
    servidor.examen.red = true; await page.click('#bReintentarJuego');
    await expect(page.locator('#bEmpezar')).toBeVisible();
  });
  test('código malo o «No soy yo»: vuelve a pedir el código', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await page.click('#bSalir');
    await expect(page.locator('#iCodigo')).toBeVisible();
    await expect(page.locator('#msgAcceso')).toContainText('Has salido');
  });
  test('el modo examen cumple el contrato de los modos', async ({ page, servidor }) => {
    await page.goto('jugar.html?t=no-existe');
    const r = await page.evaluate(async () => { const { cargarModo } = await import('/js/nucleo/modos.js'); const m = await cargarModo('examen'); return { id: m.id, nombre: m.nombre, necesita: m.necesita, tipos: m.tiposPregunta }; });
    expect(r).toEqual({ id: 'examen', nombre: 'Examen', necesita: { directo: false, servidor: true }, tipos: ['opcion_multiple', 'verdadero_falso', 'numerica', 'respuesta_corta'] });
  });
});

test.describe('hacer el examen: sin corrección a la vista', () => {
  test('empieza: contador, reloj, barra y la pregunta; ningún rastro de solución ni de corrección', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await expect(page.locator('#contador')).toHaveText('1/5');
    await expect(page.locator('#reloj')).toBeVisible();
    await expect(page.locator('#reloj')).toHaveText(/^(19:5\d|20:00)$/);
    await expect(page.locator('#barra i')).toHaveCount(5);
    await expect(page.locator('.chips .tipo')).toHaveText('Elige la correcta');
    await expect(page.locator('.op')).toHaveCount(4);
    await expect(page.locator('#bAnt')).toBeDisabled();
    await sinDesborde(page);
    // contestar no cambia nada visible más que la selección
    await opcion(page, 'B t1').click();
    await expect(page.locator('.veredicto, .solu, .q.resuelta, .op.ok, .op.bien, .op.mal')).toHaveCount(0);
    const texto = await page.locator('body').innerText();
    for (const secreto of ['SOLUCION-', 'TRAMPA-', 'SALIDA-SECRETA', 'canarioXYZ', '9182736']) expect(texto).not.toContain(secreto);
    // y el servidor no mandó nunca nada de eso
    const mandado = JSON.stringify(S.llamadas.map(x => x.r));
    for (const secreto of ['SOLUCION-', 'TRAMPA-', 'SALIDA-SECRETA', 'canarioXYZ', '9182736']) expect(mandado).not.toContain(secreto);
  });
  test('opción múltiple: se puede cambiar de opción; el servidor recibe la POSICIÓN y la guarda como opción original', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    const textos = await page.locator('.op .tx').allTextContents();
    expect(textos).toEqual(['D t1', 'C t1', 'B t1', 'A t1']);                   // el servidor las manda barajadas (aquí, al revés)
    await opcion(page, 'C t1').click();
    await expect(opcion(page, 'C t1')).toHaveClass(/elegida/);
    await opcion(page, 'B t1').click();
    await expect(page.locator('.op.elegida')).toHaveCount(1);
    await expect(opcion(page, 'B t1')).toHaveClass(/elegida/);
    await expect.poll(() => S.ultima().respuestas['grande/t1mc']).toMatchObject({ dada: 1, ok: true });   // «B» es la opción original 1
    const enviadas = S.llamadas.filter(x => x.fn === 'responder').map(x => x.args.p_dada);
    expect(enviadas).toEqual([1, 2]);                                         // posiciones: «C» estaba en la 1, «B» en la 2
  });
  test('verdadero/falso: se elige y se cambia', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await siguiente(page);
    await expect(page.locator('.chips .tipo')).toHaveText('¿Verdadero o falso?');
    await page.click('.op[data-valor="false"]');
    await expect(page.locator('.op[data-valor="false"]')).toHaveClass(/elegida/);
    await expect.poll(() => S.ultima().respuestas['grande/t1vf']).toMatchObject({ dada: false, ok: false });
    await page.click('.op[data-valor="true"]');
    await expect.poll(() => S.ultima().respuestas['grande/t1vf']).toMatchObject({ dada: true, ok: true });
  });
  test('numérica: Guardar o Intro; coma decimal y tolerancia; algo que no es número no se manda', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await siguiente(page); await siguiente(page);
    await expect(page.locator('.chips .tipo')).toHaveText('Haz la cuenta');
    await page.fill('.resp-escrita input', 'cuarenta'); await page.click('.resp-escrita button');
    await expect(page.locator('.aviso-resp')).toContainText('solo un número');
    expect(S.llamadas.filter(x => x.fn === 'responder')).toHaveLength(0);
    await escribir(page, '9182736,9');
    await expect(page.locator('.aviso-resp')).toContainText('Respuesta guardada');
    await expect.poll(() => S.ultima().respuestas['grande/t1n']).toMatchObject({ dada: '9182736,9', ok: true });
    await expect(page.locator('.veredicto, .respuesta')).toHaveCount(0);
  });
  test('respuesta corta: sin acentos ni mayúsculas, y lo escrito sin guardar se guarda solo al cambiar de pregunta', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await siguiente(page); await siguiente(page); await siguiente(page);
    await expect(page.locator('.chips .tipo')).toHaveText('Respuesta corta');
    await page.fill('.resp-escrita input', '  CANÁRIOXYZ1. ');
    await expect(page.locator('.aviso-resp')).toContainText('Falta guardar');
    await siguiente(page);                                                      // sin pulsar Guardar
    await expect.poll(() => (S.ultima().respuestas['grande/t2c'] || {}).ok).toBe(true);
    await page.click('#bAnt');
    await expect(page.locator('.resp-escrita input')).toHaveValue('CANÁRIOXYZ1.');
    await expect(page.locator('.aviso-resp')).toContainText('Respuesta guardada');
  });
  test('«Ninguna de las anteriores» se queda la última', async ({ page, servidor }) => {
    await empezar(page, servidor);
    for (let i = 0; i < 4; i++) await siguiente(page);
    await expect(page.locator('.op .tx').last()).toHaveText('Ninguna de las anteriores');
  });
  test('navegar: contador, barra (contestadas en azul), anterior y siguiente; al volver se ve lo elegido', async ({ page, servidor }) => {
    await empezar(page, servidor);
    await opcion(page, 'B t1').click();
    await expect(page.locator('#barra i').first()).toHaveClass(/hecha/);
    await siguiente(page);
    await expect(page.locator('#contador')).toHaveText('2/5');
    await expect(page.locator('#bSig')).toHaveText('Siguiente →');
    await page.click('#bAnt');
    await expect(opcion(page, 'B t1')).toHaveClass(/elegida/);
    for (let i = 0; i < 4; i++) await siguiente(page);
    await expect(page.locator('#bSig')).toHaveText('Revisar y entregar →');
  });
  test('teclado: 1-4 elige opción, V/F verdadero y falso, flechas cambian de pregunta', async ({ page, servidor }) => {
    test.skip(movil(), 'el teclado es de escritorio');
    const S = await empezar(page, servidor);
    await page.keyboard.press('3');
    await expect.poll(() => (S.ultima().respuestas['grande/t1mc'] || {}).dada).toBe(1);   // la 3.ª opción mostrada es «B t1», que es la original 1
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('f');
    await expect.poll(() => (S.ultima().respuestas['grande/t1vf'] || {}).dada).toBe(false);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#contador')).toHaveText('1/5');
  });
  test('las pantallas del examen no se desbordan en horizontal ni sacan el reloj de la cabecera', async ({ page, servidor }) => {
    await empezar(page, servidor);
    for (let i = 0; i < 5; i++) {
      await sinDesborde(page);
      const caja = await page.locator('#reloj').boundingBox();
      expect(caja.x + caja.width).toBeLessThanOrEqual(page.viewportSize().width);
      if (i < 4) await siguiente(page);
    }
  });
});

test.describe('revisar, entregar y la nota', () => {
  test('la revisión marca lo que falta; entregar pide confirmación; luego, «entregado» sin nota', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await opcion(page, 'B t1').click();
    await aRevisar(page);
    await expect(page.locator('.portada h1')).toContainText('Has contestado 1 de 5');
    await expect(page.locator('.rejilla button.vacia')).toHaveCount(4);
    await expect(page.locator('.rejilla button.hecha')).toHaveCount(1);
    await page.locator('.rejilla button.vacia').first().click();                // ir a una en blanco
    await expect(page.locator('#contador')).toHaveText('2/5');
    await aRevisar(page);
    await page.click('#bEntregar');
    await expect(page.locator('.aviso-examen.rojo')).toContainText('¿Seguro?');
    await page.click('#bVolver');                                               // «No, seguir revisando»
    await expect(page.locator('.q.en-examen')).toBeVisible();
    expect(S.ultima().estado).toBe('en_curso');
    await aRevisar(page);
    await page.click('#bEntregar'); await page.click('#bConfirmar');
    await expect(page.locator('.portada h1')).toHaveText('✓ Entregado');
    await expect(page.locator('#escena')).toContainText('Has contestado 1 de 5');
    await expect(page.locator('#estadoNota')).toContainText('verás cuando tu profesor la publique');
    expect(S.ultima().estado).toBe('entregada');
    expect(await page.locator('body').innerText()).not.toMatch(/nota:|sobre 10/i);
    await sinDesborde(page);
  });
  test('«Comprobar si ya hay nota»: antes de publicar no hay; después, la nota; con soluciones permitidas, la revisión', async ({ page, servidor }) => {
    const S = await empezar(page, servidor, { asignacion: { mostrar_soluciones: true } });
    await opcion(page, 'B t1').click();                                         // acierta 1 de 5
    await aRevisar(page); await page.click('#bEntregar'); await page.click('#bConfirmar');
    await page.click('#bNota');
    await expect(page.locator('#estadoNota')).toContainText('Todavía no está publicada');
    S.publicarNotas(true);
    await page.click('#bNota');
    await expect(page.locator('#estadoNota')).toContainText('Tu nota: 2 sobre 10 · 1 de 5 bien');
    await expect(page.locator('#detalleNota .caja')).toHaveCount(5);
    await expect(page.locator('#detalleNota')).toContainText('SOLUCION-t1mc');
    await expect(page.locator('#detalleNota .caja.porque')).toHaveCount(1);
  });
  test('volver a entrar tras entregar: «Ya has entregado» y ninguna forma de repetirlo', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await aRevisar(page); await page.click('#bEntregar'); await page.click('#bConfirmar');
    await page.click('#bSalirFinal');
    await expect(page.locator('#iCodigo')).toBeVisible();
    await entrar(page);
    await expect(page.locator('#estadoExamen')).toContainText('Ya has entregado este examen. Tu nota la verás cuando tu profesor la publique');
    await expect(page.locator('#bEmpezar')).toHaveCount(0);
    S.publicarNotas(true);
    await page.click('#bActualizar');
    await expect(page.locator('#estadoExamen')).toContainText('Tu nota: 0 sobre 10');
  });
  test('la portada dice cuántos intentos lleva y cuántos le quedan', async ({ page, servidor }) => {
    await abrir(page, servidor, { asignacion: { intentos: 3 } });
    await expect(page.locator('.reglas-examen')).toContainText('Tienes 3 intentos.');
    await expect(page.locator('.reglas-examen')).not.toContainText('Has hecho');
    await page.click('#bEmpezar'); await expect(page.locator('.q.en-examen')).toBeVisible();
    await page.reload(); await entrar(page);                                    // recargar a mitad: sigue en el intento 1
    await expect(page.locator('.reglas-examen')).toContainText('Estás en el intento 1 de 3.');
    await page.click('#bEmpezar'); await expect(page.locator('.q.en-examen')).toBeVisible();
    await aRevisar(page); await page.click('#bEntregar'); await page.click('#bConfirmar');
    await page.click('#bSalirFinal'); await entrar(page);
    await expect(page.locator('.reglas-examen')).toContainText('Has hecho 1 de 3. Te quedan 2.');
    await page.click('#bEmpezar'); await expect(page.locator('.q.en-examen')).toBeVisible(); await aRevisar(page); await page.click('#bEntregar'); await page.click('#bConfirmar');
    await page.click('#bSalirFinal'); await entrar(page);
    await expect(page.locator('.reglas-examen')).toContainText('Has hecho 2 de 3. Te queda 1.');
  });
  test('volver a entrar con todos los intentos gastados: «Ver mi resultado» enseña la nota y la revisión', async ({ page, servidor }) => {
    const S = await empezar(page, servidor, { asignacion: { mostrar_soluciones: true } });
    await opcion(page, 'B t1').click();
    await aRevisar(page); await page.click('#bEntregar'); await page.click('#bConfirmar');
    await page.click('#bSalirFinal');
    await entrar(page);
    await page.click('#bVerResultado');
    await expect(page.locator('#estadoNota')).toContainText('Todavía no está publicada');
    S.publicarNotas(true);
    await page.click('#bVerResultado');
    await expect(page.locator('#estadoNota')).toContainText('Tu nota: 2 sobre 10 · 1 de 5 bien');
    await expect(page.locator('#detalleNota .caja')).toHaveCount(5);
  });
});

test.describe('si algo falla', () => {
  test('recargar la página y volver a entrar: continúa donde iba, con lo contestado y el reloj', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await opcion(page, 'B t1').click();
    await siguiente(page); await page.click('.op[data-valor="true"]');
    await expect.poll(() => Object.keys(S.ultima().respuestas).length).toBe(2);
    await page.reload();
    await entrar(page);
    await expect(page.locator('#estadoExamen')).toContainText('Tienes un examen empezado');
    await expect(page.locator('#bEmpezar')).toHaveText('Continuar el examen →');
    await page.click('#bEmpezar');
    await expect(page.locator('#contador')).toHaveText('3/5');                  // la primera sin contestar
    await page.click('#bAnt'); await page.click('#bAnt');
    await expect(opcion(page, 'B t1')).toHaveClass(/elegida/);
    await siguiente(page);
    await expect(page.locator('.op[data-valor="true"]')).toHaveClass(/elegida/);
    expect(S.partidas).toHaveLength(1);
    await expect.poll(() => S.eventos.map(e => e.tipo)).toContain('recarga');
  });
  test('se corta internet: avisa, las respuestas esperan y se envían solas al volver; entregar no entrega con respuestas sin guardar', async ({ page, servidor }) => {
    const S = await empezar(page, servidor, { ajustes: { reintentoMs: 300, esperaEntregaMs: 1500 } });
    S.red = false;
    await opcion(page, 'B t1').click();
    await expect(page.locator('.aviso-examen.rojo')).toContainText('Sin conexión');
    await expect(opcion(page, 'B t1')).toHaveClass(/elegida/);                  // en pantalla sigue contestada
    expect(S.ultima().respuestas['grande/t1mc']).toBeUndefined();
    await aRevisar(page); await page.click('#bEntregar'); await page.click('#bConfirmar');
    await expect(page.locator('#escena')).toContainText('No he podido guardar 1 respuesta');
    await expect(page.locator('#escena')).toContainText('Tu examen sigue abierto');
    expect(S.ultima().estado).toBe('en_curso');
    S.red = true;
    await expect.poll(() => (S.ultima().respuestas['grande/t1mc'] || {}).ok).toBe(true);
    await page.click('#bOtraVez');                                              // Reintentar
    await expect(page.locator('.portada h1')).toHaveText('✓ Entregado');
    expect(S.ultima().estado).toBe('entregada');
    await expect.poll(() => S.eventos.map(e => e.tipo)).toContain('sin_red');
  });
  test('si vuelve internet con el examen abierto, el aviso desaparece y la respuesta llega', async ({ page, servidor }) => {
    const S = await empezar(page, servidor, { ajustes: { reintentoMs: 300 } });
    S.red = false; await opcion(page, 'C t1').click();
    await expect(page.locator('.aviso-examen.rojo')).toBeVisible();
    S.red = true;
    await expect(page.locator('.aviso-examen.rojo')).toHaveCount(0);
    await expect.poll(() => S.ultima().respuestas['grande/t1mc']).toMatchObject({ dada: 2, ok: false });
  });
  test('salir de la pestaña se anota (salida y vuelta con los segundos) y se avisa', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    const visibilidad = estado => page.evaluate(e => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => e }); document.dispatchEvent(new Event('visibilitychange')); }, estado);
    await visibilidad('hidden');
    await expect.poll(() => S.eventos.map(e => e.tipo)).toEqual(['salida']);
    await visibilidad('visible');
    await expect.poll(() => S.eventos.map(e => e.tipo)).toEqual(['salida', 'vuelta']);
    expect(Number.isInteger(S.eventos[1].detalle.segundos)).toBe(true);
    await expect(page.locator('.aviso-examen')).toContainText('Has salido de la página una vez');
    await visibilidad('hidden'); await visibilidad('visible');
    await expect(page.locator('.aviso-examen')).toContainText('2 veces');
  });
  test('pulsar en otra ventana (la del examen sigue visible) se anota como foco perdido, con los segundos al volver', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => S.eventos.map(e => e.tipo + ':' + (e.detalle && e.detalle.foco))).toEqual(['otro:perdido']);
    await expect(page.locator('.aviso-examen')).toContainText('Has pulsado fuera de la ventana del examen');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => S.eventos.map(e => e.tipo + ':' + (e.detalle && e.detalle.foco))).toEqual(['otro:perdido', 'otro:vuelto']);
    expect(Number.isInteger(S.eventos[1].detalle.segundos)).toBe(true);
  });
  test('un foco perdido muy corto (notificación del sistema) no se anota', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); setTimeout(() => window.dispatchEvent(new Event('focus')), 200); });
    await page.waitForTimeout(2000);
    expect(S.eventos).toEqual([]);
  });
  test('si al perder el foco la pestaña queda oculta, cuenta solo como salida (sin foco duplicado)', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(2000);
    expect(S.eventos.map(e => e.tipo)).toEqual(['salida']);
  });
  test('se acaba el tiempo: se entrega solo', async ({ page, servidor }) => {
    await page.clock.install();
    const S = await empezar(page, servidor);
    await opcion(page, 'B t1').click();
    await page.clock.fastForward('21:00');
    await expect(page.locator('.portada .sup')).toHaveText('SE ACABÓ EL TIEMPO');
    await expect(page.locator('.portada h1')).toHaveText('✓ Entregado');
    expect(S.ultima().estado).toBe('entregada');
    await expect(page.locator('#reloj')).toBeHidden();
  });
  test('el reloj se pone ámbar y rojo al final', async ({ page, servidor }) => {
    await page.clock.install();
    await empezar(page, servidor);
    await page.clock.fastForward('16:00');
    await expect(page.locator('#reloj')).toHaveClass(/poco/);
    await page.clock.fastForward('03:30');
    await expect(page.locator('#reloj')).toHaveClass(/muy-poco/);
  });
  test('si el servidor dice que se acabó el tiempo, se cierra el examen sin perder nada del resto', async ({ page, servidor }) => {
    const S = await empezar(page, servidor);
    await opcion(page, 'B t1').click();
    await expect.poll(() => Object.keys(S.ultima().respuestas).length).toBe(1);
    S.caducar(60);
    await siguiente(page); await page.click('.op[data-valor="true"]');
    await expect(page.locator('.portada .sup')).toHaveText('SE ACABÓ EL TIEMPO');
    await expect(page.locator('#escena')).toContainText('Has contestado');
    expect(S.ultima().estado).toBe('caducada');
  });
  test('desde cualquier pregunta se puede ir directo a «Revisar y entregar» (atajo «Entregar»)', async ({ page, servidor }) => {
    await empezar(page, servidor);
    await expect(page.locator('#bFin')).toBeVisible();
    await page.click('#bFin');
    await expect(page.locator('.portada.final .sup')).toHaveText('ANTES DE ENTREGAR');
    await page.click('.rejilla button >> nth=1');                 // vuelve a una pregunta
    await expect(page.locator('#bFin')).toBeVisible();
    await page.click('#bFin');
    await page.click('#bEntregar'); await page.click('#bConfirmar');
    await expect(page.locator('.portada.final h1')).toHaveText('✓ Entregado');
  });
  test('sin ningún error de JavaScript en toda la sesión', async ({ page, servidor }) => {
    const errores = []; page.on('pageerror', e => errores.push(e.message)); page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
    await empezar(page, servidor);
    await opcion(page, 'B t1').click(); await siguiente(page); await page.click('.op[data-valor="true"]'); await siguiente(page); await escribir(page, '1');
    for (let i = 0; i < 2; i++) await siguiente(page);
    await siguiente(page); await page.click('#bEntregar'); await page.click('#bConfirmar'); await page.click('#bNota');
    await expect(page.locator('#estadoNota')).toBeVisible();
    expect(errores).toEqual([]);
  });
});
