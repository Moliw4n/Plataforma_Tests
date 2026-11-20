/* La web juega tests en formato 1 y en formato 2 exactamente igual. */
const { test, expect, entrar, hacerTest, cargarTest, CODIGO_BUENO } = require('./fixtures');
const path = require('path');
const { pathToFileURL } = require('url');

const ID = 'tda2-u1-python-practica';
const T1 = cargarTest(ID);
let F;
test.beforeAll(async () => { F = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'nucleo', 'formato.js')).href); });

// Baraja siempre igual, para poder comparar las dos páginas
const fijarAzar = page => page.addInitScript(() => { let s = 4242; Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647; });
const servir = (page, nombre, cuerpo) => page.route('**/tests/' + nombre + '.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(cuerpo) }));

test('un test en formato 2 se ve IGUAL que el mismo en formato 1 (portada y pregunta)', async ({ page, browser }) => {
  await servir(page, 'f2', F.aFormato2(T1));
  await fijarAzar(page);
  await page.goto('jugar.html?t=f2&modo=profe');
  const portada2 = await page.locator('#escena').innerHTML();
  await page.click('#bEmpezar');
  const pregunta2 = await page.locator('#escena').innerHTML();

  const p1 = await (await browser.newContext({ viewport: page.viewportSize() })).newPage();
  await fijarAzar(p1);
  await p1.goto('jugar.html?t=' + ID + '&modo=profe');
  const portada1 = await p1.locator('#escena').innerHTML();
  await p1.click('#bEmpezar');
  const pregunta1 = await p1.locator('#escena').innerHTML();
  expect(portada2).toBe(portada1);
  expect(pregunta2).toBe(pregunta1);
});

test('formato 2: se juega entero y se guarda con el mismo formato de siempre', async ({ page, servidor }) => {
  await servir(page, 'f2', F.aFormato2(T1));
  await page.goto('jugar.html?t=f2');
  await entrar(page);
  await page.click('#bEmpezar');
  await hacerTest(page, T1, 2);
  await expect(page.locator('#guardado')).toContainText('Resultado guardado');
  const g = servidor.guardados[0];
  expect(g.p_codigo).toBe(CODIGO_BUENO);
  expect(Object.keys(g.p_datos).sort()).toEqual(['aciertos', 'empezado', 'nota', 'respuestas', 'segundos', 'terminado', 'test', 'total', 'version']);
  expect(g.p_datos).toMatchObject({ test: ID, total: 40, aciertos: 38 });
  expect(Object.keys(g.p_datos.respuestas[0]).sort()).toEqual(['elegida', 'id', 'ms', 'ok']);
});

test('formato 2 con categorías propias: la etiqueta usa su nombre y su color', async ({ page }) => {
  const t = F.aFormato2(cargarTest('tda1-u1u2-repaso'));
  await servir(page, 'f2-tda1', t);
  await page.goto('jugar.html?t=f2-tda1&modo=profe');
  await expect(page.locator('.leyenda .tipo')).toHaveText(['Concepto', 'Haz la cuenta', 'Caso práctico']);
  await page.click('#bEmpezar');
  await expect(page.locator('.chips .tipo')).toHaveCount(1);
});

test('un test con problemas se sigue jugando y solo avisa en la consola', async ({ page }) => {
  const t = F.aFormato2(T1);
  delete t.preguntas[3].trampa;
  await servir(page, 'f2-roto', t);
  const avisos = [];
  page.on('console', m => { if (m.type() === 'warning') avisos.push(m.text()); });
  await page.goto('jugar.html?t=f2-roto&modo=profe');
  await expect(page.locator('#bEmpezar')).toBeVisible();
  await page.click('#bEmpezar');
  await expect(page.locator('.op')).toHaveCount(4);
  expect(avisos.join('\n')).toContain('tiene problemas');
  expect(avisos.join('\n')).toContain('falta «trampa»');
});

test('metadatos nuevos (dificultad, criterio, etiquetas) no estorban', async ({ page }) => {
  const t = F.aFormato2(T1);
  t.preguntas[0] = { ...t.preguntas[0], dificultad: 2, criterio: '2.1', etiquetas: ['print'] };
  await servir(page, 'f2-meta', t);
  await page.goto('jugar.html?t=f2-meta&modo=profe');
  await page.click('#bEmpezar');
  await expect(page.locator('.enun')).toHaveText(T1.preguntas[0].enun);
});
