/* El modo DIRECTO del alumno en la web (jugar.html?d=<sala>), a 1280 y a 390 px. El servidor es el falso de pruebas/servidor-directo-falso.js,
   que responde con la misma forma que el SQL real (lo comprueba pruebas/contrato-directo.test.js) y deja al «profesor» mover la sala con S.avanzar(). */
const { test, expect, entrar } = require('./fixtures');
const { crearServidorDirecto } = require('./servidor-directo-falso');

const AJUSTES = { sondeoMs: 120, sondeoPreguntaMs: 80, reintentoRespMs: 120 };      // sondeos rápidos para que las pruebas no esperen
const movil = () => test.info().project.name === 'movil';
const sinDesborde = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

async function abrir(page, servidor, opciones = {}, { entrarYa = true, url = 'jugar.html?d=123456' } = {}) {
  const S = servidor.directo = await crearServidorDirecto(opciones);
  await page.addInitScript(a => { window.KIRON_AJUSTES = a; }, AJUSTES);
  await page.goto(url);
  if (entrarYa) await entrar(page);
  return S;
}
// La sala ya en la primera pregunta
async function enPregunta(page, servidor, opciones) {
  const S = await abrir(page, servidor, opciones);
  await expect(page.locator('.directo-espera h1')).toHaveText('¡Estás dentro!');
  S.avanzar();
  await expect(page.locator('.q.en-examen')).toBeVisible();
  return S;
}
const opcion = (page, texto) => page.locator('.q.en-examen .op', { hasText: texto });
const cerrar = async (S, page) => { S.avanzar(); await expect(page.locator('.directo-res h1')).toBeVisible(); };   // «cerrar ya» y esperar el resultado

test.describe('acceso', () => {
  test('el enlace con la sala pide el código; con una sala mal escrita, mensaje claro y sin pedir nada', async ({ page, servidor }) => {
    await abrir(page, servidor, {}, { entrarYa: false });
    await expect(page.locator('#iCodigo')).toBeVisible();
    await expect(page.locator('#escena')).toContainText('Entra en la sala');
    await expect(page).toHaveTitle(/Directo · Kiron/);
    await sinDesborde(page);
    for (const mala of ['12', '1234567', 'abcdef']) {
      await page.goto('jugar.html?d=' + mala);
      await expect(page.locator('#escena')).toContainText('El enlace de la sala no está bien');
      await expect(page.locator('#iCodigo')).toHaveCount(0);
    }
  });
  test('una sala que no existe, o que ya terminó: mensaje claro y se puede salir', async ({ page, servidor }) => {
    await abrir(page, servidor, {}, { url: 'jugar.html?d=999999' });
    await expect(page.locator('#escena')).toContainText('Esa sala no existe, ya ha terminado o no es para tu grupo');
    await page.click('#bSalirDirecto');
    await expect(page.locator('#iCodigo')).toBeVisible();
    servidor.directo.terminar();
    await entrar(page);
    await expect(page.locator('#escena')).toContainText('ya ha terminado');
  });
  test('un código de alumno que el servidor no conoce: mensaje y vuelta al principio', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, { alumnos: {} }, { entrarYa: false });
    S.alumnos = {};                                                   // la comprobación de entrar() de las pruebas dice que sí; la sala dice que no
    await entrar(page);
    await expect(page.locator('#escena')).toContainText('No he podido comprobar tu código');
  });
});

test.describe('espera y pregunta', () => {
  test('al entrar: «Estás dentro» con su apodo (nada de su identidad real) y cuántos hay', async ({ page, servidor }) => {
    const S = await abrir(page, servidor);
    await expect(page.locator('.directo-espera h1')).toHaveText('¡Estás dentro!');
    await expect(page.locator('#apodoGrande')).toHaveText('Zorro Azul');
    await expect(page.locator('#escena')).toContainText('1 jugador');
    await expect(page.locator('#escena')).toContainText('Esperando a que tu profesor empiece');
    expect(await page.locator('body').innerText()).not.toMatch(/TDA2|07/);
    S.sembrar([100, 200]);
    await expect(page.locator('#escena')).toContainText('3 jugadores');
    await sinDesborde(page);
  });
  test('al abrirse la pregunta aparece con sus opciones, el reloj y la barra de tiempo, y NUNCA con soluciones', async ({ page, servidor }) => {
    await enPregunta(page, servidor);
    await expect(page.locator('.q .enun')).toHaveText('Enunciado t1mc');
    await expect(page.locator('.q.en-examen .op')).toHaveCount(4);
    await expect(opcion(page, 'A t1')).toBeVisible();
    await expect(page.locator('#reloj')).toBeVisible();
    await expect(page.locator('#reloj')).toHaveText(/^\d\d:\d\d$/);
    await expect(page.locator('#contador')).toHaveText('1/3');
    await expect(page.locator('#barraTiempo')).toBeAttached();
    const html = await page.content();
    for (const prohibido of ['SOLUCION-', 'TRAMPA-', 'SALIDA-SECRETA']) expect(html).not.toContain(prohibido);
    await sinDesborde(page);
    if (movil()) for (const b of await page.locator('.q.en-examen .op').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);   // se pulsa con el pulgar
  });
  test('la pregunta no se repinta en cada sondeo (no pierde lo que el alumno está haciendo)', async ({ page, servidor }) => {
    await enPregunta(page, servidor);
    await page.evaluate(() => { document.querySelector('.q.en-examen').dataset.marca = 'sigo-aqui'; });
    await page.waitForTimeout(700);                                   // varios sondeos
    expect(await page.evaluate(() => document.querySelector('.q.en-examen').dataset.marca)).toBe('sigo-aqui');
  });
  test('entrar con la sala ya empezada: va directo a la pregunta', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, {}, { entrarYa: false });
    S.avanzar();
    await entrar(page);
    await expect(page.locator('.q.en-examen')).toBeVisible();
  });
  test('verdadero/falso: dos botones grandes y se contesta con true/false', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor, { preguntas: ['t1vf'] });
    await expect(page.locator('.q.en-examen .op')).toHaveCount(2);
    await page.locator('.q.en-examen .op').first().click();
    await expect(page.locator('#estadoEnvio')).toContainText('Respuesta enviada');
    expect(S.respuestas.map(r => r.dada)).toEqual([true]);
    await cerrar(S, page);
    await expect(page.locator('.directo-res h1')).toHaveText('✓ ¡Correcto!');
    await expect(page.locator('.caja.porque')).toContainText('Verdadero');
  });
});

test.describe('contestar', () => {
  test('al elegir una opción se envía UNA vez, se avisa y no se dice si acertó hasta que se cierre', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    await opcion(page, 'B t1').click();
    await expect(page.locator('.directo-espera h1')).toHaveText('¡Contestada!');
    await expect(page.locator('#estadoEnvio')).toContainText('Respuesta enviada');
    const cuerpo = await page.locator('#escena').innerText();
    expect(cuerpo).not.toMatch(/¡Correcto|Fallaste|No contestaste|\+\d+ puntos/);
    expect(S.llamadas.filter(l => l.fn === 'directo_responder').map(l => [l.args.p_pregunta, l.args.p_dada])).toEqual([[0, 1]]);   // posición 1 = «B»
    await expect(page.locator('.q.en-examen')).toHaveCount(0);        // ya no se puede cambiar
    await page.waitForTimeout(500);
    expect(S.respuestas).toHaveLength(1);
  });
  test('acierta: ✓ ¡Correcto!, +puntos (500-1000), la correcta con su porqué, su posición y el marcador con «(tú)»', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    await opcion(page, 'B t1').click();
    await expect(page.locator('#estadoEnvio')).toContainText('enviada');
    await cerrar(S, page);
    await expect(page.locator('.directo-res h1')).toHaveText('✓ ¡Correcto!');
    const pts = Number((await page.locator('.mas-puntos').textContent()).replace(/\D/g, ''));
    expect(pts).toBeGreaterThanOrEqual(500); expect(pts).toBeLessThanOrEqual(1000);
    await expect(page.locator('.caja.porque')).toContainText('B · B t1');
    await expect(page.locator('.caja.porque')).toContainText('SOLUCION-t1mc');
    await expect(page.locator('.posicion')).toContainText('Vas 1.º de 1');
    await expect(page.locator('.marcador li.yo')).toContainText('Zorro Azul (tú)');
    await expect(page.locator('#escena')).toContainText('Esperando la siguiente pregunta');
    await sinDesborde(page);
  });
  test('falla: ✗ Fallaste, sin puntos, y se le enseña la correcta', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    await opcion(page, 'A t1').click();
    await expect(page.locator('#estadoEnvio')).toContainText('enviada');
    await cerrar(S, page);
    await expect(page.locator('.directo-res h1')).toHaveText('✗ Fallaste');
    await expect(page.locator('.mas-puntos')).toHaveCount(0);
    await expect(page.locator('.caja.porque')).toContainText('B · B t1');
    expect(S.puntosDe('TDA2-07')).toBe(0);
  });
  test('no contesta: ⏱ No contestaste', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    await cerrar(S, page);
    await expect(page.locator('.directo-res h1')).toHaveText('⏱ No contestaste');
    expect(S.respuestas).toHaveLength(0);
  });
  test('si se acaba el tiempo solo, pasa solo al resultado (sin que el profesor pulse nada)', async ({ page, servidor }) => {
    await enPregunta(page, servidor, { tiempoS: 1 });
    await expect(page.locator('.directo-res h1')).toHaveText('⏱ No contestaste', { timeout: 7000 });
  });
  test('el reloj baja con lo que manda el servidor', async ({ page, servidor }) => {
    await enPregunta(page, servidor, { tiempoS: 60 });
    const t1 = await page.locator('#reloj').textContent();
    expect(t1).toMatch(/^(01:00|00:59)$/);
    await page.waitForTimeout(1500);
    expect(await page.locator('#reloj').textContent()).not.toBe(t1);
  });
});

test.describe('una partida entera', () => {
  test('3 preguntas: pregunta → resultado → … → «Se acabó», con su puesto, sus aciertos y el podio; y se puede salir', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, { preguntas: ['t1mc', 't1vf', 't2mc'] });
    S.sembrar([1500, 900, 400]);
    await expect(page.locator('.directo-espera h1')).toBeVisible();
    S.avanzar();
    await opcion(page, 'B t1').click(); await expect(page.locator('#estadoEnvio')).toContainText('enviada'); await cerrar(S, page);
    S.avanzar();                                                                   // pregunta 2
    await expect(page.locator('#contador')).toHaveText('2/3');
    await page.locator('.q.en-examen .op').first().click(); await expect(page.locator('#estadoEnvio')).toContainText('enviada'); await cerrar(S, page);
    S.avanzar();                                                                   // pregunta 3
    await expect(page.locator('#contador')).toHaveText('3/3');
    await opcion(page, 'A t2').click(); await expect(page.locator('#estadoEnvio')).toContainText('enviada'); await cerrar(S, page);      // esta falla
    S.avanzar();                                                                   // se acabó
    await expect(page.locator('.directo-res h1')).toHaveText('¡Se acabó!');
    await expect(page.locator('.posicion')).toContainText('Has quedado');
    await expect(page.locator('#escena')).toContainText('Acertaste 2 de 3 preguntas');
    await expect(page.locator('.marcador li')).toHaveCount(4);
    await expect(page.locator('.marcador li.yo')).toHaveCount(1);
    await sinDesborde(page);
    expect(await page.locator('#reloj').isHidden()).toBe(true);
    await page.click('#bSalirDirecto');
    await expect(page.locator('#iCodigo')).toBeVisible();
    await expect(page.locator('#escena')).toContainText('Has salido');
  });
  test('si el profesor termina la sala a medias, el alumno ve el final', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    S.terminar();
    await expect(page.locator('.directo-res h1')).toHaveText('¡Se acabó!');
  });
  test('el marcador enseña solo los 5 primeros y dice en qué puesto vas', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    S.sembrar([9000, 8000, 7000, 6000, 5000, 4000, 3000]);
    await opcion(page, 'B t1').click(); await expect(page.locator('#estadoEnvio')).toContainText('enviada'); await cerrar(S, page);
    await expect(page.locator('.marcador li')).toHaveCount(5);
    await expect(page.locator('.posicion')).toContainText('Vas 8.º de 8');
  });
});

test.describe('si algo falla', () => {
  test('recargar sin haber contestado: vuelve a la MISMA pregunta con su apodo', async ({ page, servidor }) => {
    await enPregunta(page, servidor);
    await page.reload(); await entrar(page);
    await expect(page.locator('.q .enun')).toHaveText('Enunciado t1mc');
    await expect(page.locator('.apodo-chip')).toHaveText('Zorro Azul');
  });
  test('recargar después de contestar: sigue «Contestada» y no se puede contestar otra vez', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    await opcion(page, 'B t1').click(); await expect(page.locator('#estadoEnvio')).toContainText('enviada');
    await page.reload(); await entrar(page);
    await expect(page.locator('.directo-espera h1')).toHaveText('¡Contestada!');
    await expect(page.locator('.q.en-examen')).toHaveCount(0);
    expect(S.respuestas).toHaveLength(1);
  });
  test('recargar con el resultado en pantalla: lo vuelve a ver, con sus puntos', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    await opcion(page, 'B t1').click(); await expect(page.locator('#estadoEnvio')).toContainText('enviada'); await cerrar(S, page);
    const antes = await page.locator('.mas-puntos').textContent();
    await page.reload(); await entrar(page);
    await expect(page.locator('.directo-res h1')).toHaveText('✓ ¡Correcto!');
    await expect(page.locator('.mas-puntos')).toHaveText(antes);
  });
  test('se corta internet al contestar: avisa, la respuesta espera y se envía sola al volver (una sola vez)', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    S.red = false;
    await opcion(page, 'B t1').click();
    await expect(page.locator('#estadoEnvio')).toContainText('Sin conexión: tu respuesta se enviará');
    await expect(page.locator('#avisoRedDirecto')).toContainText('Sin conexión');
    expect(S.respuestas).toHaveLength(0);
    S.red = true;
    await expect(page.locator('#estadoEnvio')).toContainText('Respuesta enviada');
    await expect(page.locator('#avisoRedDirecto')).toHaveCount(0);
    expect(S.respuestas).toHaveLength(1);
    expect(S.respuestas[0].dada).toBe(1);
  });
  test('se corta internet mientras espera: avisa y, al volver, sigue sin que el alumno haga nada', async ({ page, servidor }) => {
    const S = await abrir(page, servidor);
    await expect(page.locator('.directo-espera h1')).toBeVisible();
    S.red = false;
    await expect(page.locator('#avisoRedDirecto')).toBeVisible();
    await expect(page.locator('.directo-espera h1')).toBeVisible();                // no se desmonta la pantalla
    S.red = true;
    await expect(page.locator('#avisoRedDirecto')).toHaveCount(0);
    S.avanzar();
    await expect(page.locator('.q.en-examen')).toBeVisible();
  });
  test('si el servidor dice que ya no está en la sala, vuelve a entrar solo (con el mismo apodo)', async ({ page, servidor }) => {
    const S = await abrir(page, servidor);
    await expect(page.locator('.directo-espera h1')).toBeVisible();
    S.participantes.length = 0;
    await expect.poll(() => S.participantes.length).toBe(1);                      // vuelve a entrar solo
    await expect(page.locator('#apodoGrande')).toHaveText('Zorro Azul');
  });
  test('si la respuesta llega tarde (la pregunta ya se cerró), se le dice sin dar error', async ({ page, servidor }) => {
    const S = await enPregunta(page, servidor);
    S.latencia = 600;
    await opcion(page, 'B t1').click();
    S.avanzar();                                                                   // el profesor cierra mientras la respuesta viaja
    await expect(page.locator('.directo-res h1')).toBeVisible();
    expect(S.respuestas.length).toBeLessThanOrEqual(1);
  });
});

test.describe('enlace fijo (jugar.html?d): el código de la sala se escribe', () => {
  const fijo = { url: 'jugar.html?d' };
  test('tras el código de alumno pide el de la sala (teclado numérico) y entra', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, {}, fijo);
    await expect(page.locator('#iSala')).toBeVisible();
    await expect(page.locator('#escena')).toContainText('¿En qué sala entras?');
    await expect(page.locator('#iSala')).toHaveAttribute('inputmode', 'numeric');
    await sinDesborde(page);
    await page.fill('#iSala', '123456');
    await expect(page.locator('#iSala')).toHaveValue('123 456');                         // se escribe con el espacio en medio, como en la pantalla del profesor
    await page.click('#bSalaCodigo');
    await expect(page.locator('.directo-espera h1')).toHaveText('¡Estás dentro!');
    expect(S.participantes).toHaveLength(1);
    S.avanzar();
    await expect(page.locator('.q.en-examen')).toBeVisible();
  });
  test('vale escribirlo con espacios, guiones o letras de más: solo cuentan las cifras', async ({ page, servidor }) => {
    await abrir(page, servidor, {}, fijo);
    await page.fill('#iSala', '12-34a56');
    await expect(page.locator('#iSala')).toHaveValue('123 456');
    await page.press('#iSala', 'Enter');
    await expect(page.locator('.directo-espera h1')).toBeVisible();
  });
  test('con menos de 6 cifras lo dice y no llama al servidor', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, {}, fijo);
    await page.fill('#iSala', '1234'); await page.click('#bSalaCodigo');
    await expect(page.locator('#msgSalaCodigo')).toContainText('6 cifras');
    expect(S.llamadas.filter(l => l.fn === 'directo_unirse')).toHaveLength(0);
  });
  test('una sala que no existe: avisa AQUÍ y se puede corregir sin volver a escribir el código de alumno', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, {}, fijo);
    await page.fill('#iSala', '999999'); await page.click('#bSalaCodigo');
    await expect(page.locator('#msgSalaCodigo')).toContainText('Esa sala no existe');
    await expect(page.locator('#iSala')).toBeVisible();
    await page.fill('#iSala', S.sala); await page.click('#bSalaCodigo');
    await expect(page.locator('.directo-espera h1')).toBeVisible();
  });
  test('una sala terminada también se rechaza con el mismo aviso', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, {}, fijo);
    S.terminar();
    await page.fill('#iSala', S.sala); await page.click('#bSalaCodigo');
    await expect(page.locator('#msgSalaCodigo')).toContainText('ya ha terminado');
  });
  test('«No soy yo» vuelve a pedir el código de alumno; y al salir tras jugar, se vuelve a pedir la sala', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, {}, fijo);
    await page.click('#bSalirDirecto');
    await expect(page.locator('#iCodigo')).toBeVisible();
    await entrar(page);
    await page.fill('#iSala', S.sala); await page.click('#bSalaCodigo');
    await expect(page.locator('.directo-espera h1')).toBeVisible();
    S.terminar();
    await page.click('#bSalirDirecto');
    await expect(page.locator('#iCodigo')).toBeVisible();
    await entrar(page);
    await expect(page.locator('#iSala')).toBeVisible();
  });
  test('el enlace con el código sigue funcionando igual que antes (entra directo)', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await expect(page.locator('#iSala')).toHaveCount(0);
    await expect(page.locator('.directo-espera h1')).toBeVisible();
  });
  test('con el enlace fijo, si la sala no existe y el enlace traía el código mal, no se pide otra vez: es un enlace roto', async ({ page, servidor }) => {
    await abrir(page, servidor, {}, { entrarYa: false, url: 'jugar.html?d=12' });
    await expect(page.locator('#escena')).toContainText('El enlace de la sala no está bien');
  });
});

test('sin ningún error de JavaScript en toda una partida', async ({ page, servidor }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  const S = await abrir(page, servidor, { preguntas: ['t1mc', 't1vf'] });
  await expect(page.locator('.directo-espera h1')).toBeVisible();
  S.avanzar(); await opcion(page, 'B t1').click(); await expect(page.locator('#estadoEnvio')).toContainText('enviada'); await cerrar(S, page);
  S.avanzar(); await cerrar(S, page);
  S.avanzar(); await expect(page.locator('.directo-res h1')).toHaveText('¡Se acabó!');
  expect(errores).toEqual([]);
});
