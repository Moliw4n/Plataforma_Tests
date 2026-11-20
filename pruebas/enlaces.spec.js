/* Enlaces que ya tienen los alumnos: test.html es un alias de jugar.html y no se puede romper. */
const { test, expect, entrar } = require('./fixtures');
const fs = require('fs');
const path = require('path');

const aviso = u => new URL(u);

test.describe('alias test.html → jugar.html', () => {
  test('test.html a secas abre el test por defecto', async ({ page }) => {
    await page.goto('test.html');
    await expect(page).toHaveURL(/\/jugar\.html$/);
    await expect(page.locator('.acceso h1')).toContainText('Práctica U1');
  });

  test('conserva ?t=… (el enlace que se reparte a los alumnos)', async ({ page }) => {
    await page.goto('test.html?t=tda1-u1u2-repaso');
    expect(aviso(page.url()).pathname).toBe('/jugar.html');
    expect(aviso(page.url()).search).toBe('?t=tda1-u1u2-repaso');
    await expect(page.locator('.acceso h1')).toContainText('Repaso U1 y U2');
  });

  test('conserva &modo=profe y cualquier otro parámetro (los enlaces del panel)', async ({ page }) => {
    await page.goto('test.html?t=tda1-u1u2-repaso&modo=profe&x=1');
    expect(aviso(page.url()).search).toBe('?t=tda1-u1u2-repaso&modo=profe&x=1');
    await expect(page.locator('.aviso-profe')).toContainText('NO SE GUARDA');
    await expect(page.locator('#bEmpezar')).toBeVisible();
  });

  test('conserva la parte # del enlace', async ({ page }) => {
    await page.goto('test.html?t=tda1-u1u2-repaso#pregunta-3');
    expect(aviso(page.url()).hash).toBe('#pregunta-3');
  });

  test('un código de acceso sigue funcionando entrando por el enlace antiguo', async ({ page, servidor }) => {
    await page.goto('test.html?t=tda2-u1-python-practica');
    await entrar(page);
    await expect(page.locator('.quien')).toContainText('nº 07');
  });

  test('un test inexistente por el enlace antiguo da el mismo mensaje amable', async ({ page }) => {
    await page.goto('test.html?t=no-existe');
    await expect(page.locator('#escena')).toContainText('No encuentro este test');
  });

  test('sin JavaScript queda un enlace a jugar.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'test.html'), 'utf8');
    expect(html).toContain('<a href="jugar.html">');
  });
});

test.describe('jugar.html directo', () => {
  test('abre el test por defecto y con ?t=', async ({ page }) => {
    await page.goto('jugar.html');
    await expect(page.locator('.acceso h1')).toContainText('Práctica U1');
    await page.goto('jugar.html?t=tda1-u1u2-repaso&modo=profe');
    await expect(page.locator('#bEmpezar')).toBeVisible();
  });
});

test.describe('los enlaces que genera el panel apuntan a páginas que existen', () => {
  test('todo test.html?… que aparece en panel.js sigue abriéndose', async ({ page }) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'panel.js'), 'utf8');
    const destinos = [...new Set([...src.matchAll(/['"](test\.html)\??/g)].map(m => m[1]))];
    expect(destinos).toEqual(['test.html']);        // si el panel apunta a otra cosa, hay que revisarlo
    await page.goto('test.html?t=tda2-u1-python-practica&modo=profe');
    await expect(page.locator('#bEmpezar')).toBeVisible();
  });
});
