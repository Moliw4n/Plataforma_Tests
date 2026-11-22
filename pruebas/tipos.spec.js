/* Los tipos de pregunta nuevos (verdadero_falso, numerica, respuesta_corta) jugados en la web, a 1280 y a 390 px. */
const { test, expect, entrar, CODIGO_BUENO } = require('./fixtures');

const item = (id, extra) => ({ id, enun: 'Enunciado ' + id, sol: 'Porque sí ' + id, trampa: 'Cuidado ' + id, tema: 't', ...extra });
const MC = item('mc', { tipo: 'opcion_multiple', ops: ['a', 'b', 'c', 'd'], ok: 0 });
const VF_V = item('vf1', { tipo: 'verdadero_falso', ok: true, enun: 'UTF-8 usa siempre 1 byte' });
const VF_F = item('vf2', { tipo: 'verdadero_falso', ok: false });
const NUM = item('n1', { tipo: 'numerica', valor: 47, enun: '¿Cuánto vale 2F en decimal?' });
const NUM_TOL = item('n2', { tipo: 'numerica', valor: 3.5, tolerancia: 0.5, unidad: 'GB' });
const CORTA = item('c1', { tipo: 'respuesta_corta', aceptadas: ['RAM', 'memoria RAM'], pista: 'Empieza por R', enun: 'Memoria que se borra al apagar' });

const banco = items => ({ formato: 2, id: 'b', titulo: 'Banco · Prueba', materia: 'TDA I', version: 1, preguntas: items });
async function jugar(page, items, { conCodigo = false } = {}) {
  await page.route('**/tests/b.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(banco(items)) }));
  await page.goto('jugar.html?t=b' + (conCodigo ? '' : '&modo=profe'));
  if (conCodigo) await entrar(page);
  await page.click('#bEmpezar');
}
const sinDesborde = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const movil = () => test.info().project.name === 'movil';

test.describe('portada y etiquetas', () => {
  test('sin categoría, la etiqueta usa el nombre del tipo', async ({ page }) => {
    await page.route('**/tests/b.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(banco([MC, VF_V, NUM, CORTA])) }));
    await page.goto('jugar.html?t=b&modo=profe');
    await expect(page.locator('.leyenda .tipo')).toHaveText(['Elige la correcta', '¿Verdadero o falso?', 'Haz la cuenta', 'Respuesta corta']);
    await sinDesborde(page);
  });
});

test.describe('verdadero_falso', () => {
  test('acertar: se marca la buena, veredicto y explicación', async ({ page }) => {
    await jugar(page, [VF_V]);
    await expect(page.locator('.op')).toHaveCount(2);
    await expect(page.locator('.op .tx')).toHaveText(['Verdadero', 'Falso']);
    await expect(page.locator('#pista')).toContainText('Verdadero o Falso');
    await page.click('.op[data-v="true"]');
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
    await expect(page.locator('.veredicto')).toContainText('¡CORRECTO!');
    await expect(page.locator('.op[data-v="true"] .marca-op')).toHaveText('✓');
    await expect(page.locator('.porque')).toContainText('Porque sí vf1');
    await expect(page.locator('.trampa')).toContainText('Cuidado vf1');
    await expect(page.locator('.op:not([disabled])')).toHaveCount(0);
    await sinDesborde(page);
  });
  test('fallar: veredicto rojo y la buena marcada', async ({ page }) => {
    await jugar(page, [VF_F]);
    await page.click('.op[data-v="true"]');
    await expect(page.locator('.veredicto')).toHaveClass(/fallo/);
    await expect(page.locator('.op[data-v="true"]')).toHaveClass(/mal/);
    await expect(page.locator('.op[data-v="false"] .marca-op')).toHaveText('✓');
  });
  test('teclas V y F', async ({ page }) => {
    test.skip(movil(), 'el teclado es de escritorio');
    await jugar(page, [VF_V, VF_F]);
    await page.keyboard.press('v');
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
    await page.keyboard.press('Enter');
    await page.keyboard.press('F');
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
  });
  test('al volver a la pregunta sigue contestada', async ({ page }) => {
    await jugar(page, [VF_V, VF_F]);
    await page.click('.op[data-v="false"]');
    await page.click('#bSig');
    await page.click('#bAnt');
    await expect(page.locator('.q')).toHaveClass(/resuelta/);
    await expect(page.locator('.op[data-v="false"]')).toHaveClass(/mal/);
    await expect(page.locator('.op:not([disabled])')).toHaveCount(0);
  });
});

test.describe('numerica', () => {
  test('acertar escribiendo y pulsando Comprobar', async ({ page }) => {
    await jugar(page, [NUM]);
    await expect(page.locator('.resp-escrita input')).toHaveAttribute('inputmode', 'decimal');
    await expect(page.locator('#pista')).toContainText('Escribe tu respuesta');
    await page.fill('.resp-escrita input', '47');
    await page.click('.resp-escrita button');
    await expect(page.locator('.veredicto')).toContainText('¡CORRECTO!');
    await expect(page.locator('.resp-escrita input')).toBeDisabled();
    await expect(page.locator('.resp-escrita input')).toHaveClass(/bien/);
    await expect(page.locator('.respuesta')).toContainText('47');
    await sinDesborde(page);
  });
  test('fallar: enseña la respuesta correcta', async ({ page }) => {
    await jugar(page, [NUM]);
    await page.fill('.resp-escrita input', '46');
    await page.press('.resp-escrita input', 'Enter');
    await expect(page.locator('.veredicto')).toHaveClass(/fallo/);
    await expect(page.locator('.resp-escrita input')).toHaveClass(/mal/);
    await expect(page.locator('.respuesta')).toContainText('LA RESPUESTA');
    await expect(page.locator('.respuesta')).toContainText('47');
    await expect(page.locator('.porque')).toBeVisible();
  });
  test('lo que no es un número no cuenta como respuesta: avisa y se puede corregir', async ({ page }) => {
    await jugar(page, [NUM]);
    await page.fill('.resp-escrita input', 'cuarenta y siete');
    await page.click('.resp-escrita button');
    await expect(page.locator('.aviso-resp')).toContainText('solo un número');
    await expect(page.locator('.q')).not.toHaveClass(/resuelta/);
    await page.fill('.resp-escrita input', '');
    await page.click('.resp-escrita button');
    await expect(page.locator('.aviso-resp')).toContainText('Escribe tu respuesta');
    await page.fill('.resp-escrita input', '47');
    await expect(page.locator('.aviso-resp')).toHaveText('');
    await page.click('.resp-escrita button');
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
  });
  test('tolerancia, coma decimal y unidad', async ({ page }) => {
    await jugar(page, [NUM_TOL]);
    await expect(page.locator('.unidad')).toHaveText('GB');
    await page.fill('.resp-escrita input', '3,9');
    await page.click('.resp-escrita button');
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
    await expect(page.locator('.respuesta')).toContainText('3,5 GB');
    await expect(page.locator('.respuesta')).toContainText('±0,5');
  });
  test('en móvil no abre el teclado solo; en escritorio ya está enfocado', async ({ page }) => {
    await jugar(page, [NUM]);
    const enfocado = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('entrada'));
    expect(enfocado).toBe(!movil());
  });
});

test.describe('respuesta_corta', () => {
  test('sin acentos, mayúsculas ni punto final', async ({ page }) => {
    await jugar(page, [CORTA]);
    await expect(page.locator('.pista-resp')).toHaveText('Empieza por R');
    await page.fill('.resp-escrita input', '  RÁM. ');
    await page.press('.resp-escrita input', 'Enter');
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
    await expect(page.locator('.respuesta')).toContainText('RAM');
    await expect(page.locator('.respuesta')).toContainText('también vale: memoria RAM');
  });
  test('otra aceptada, y una equivocada', async ({ page }) => {
    await jugar(page, [CORTA, CORTA]);
    await page.fill('.resp-escrita input', 'Memoria   ram');
    await page.click('.resp-escrita button');
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
    await page.click('#bSig');
    await page.fill('.resp-escrita input', 'rom');
    await page.click('.resp-escrita button');
    await expect(page.locator('.veredicto')).toHaveClass(/fallo/);
    await expect(page.locator('.respuesta')).toContainText('RAM');
  });
  test('el texto escrito no se interpreta como HTML', async ({ page }) => {
    const raro = '<img src=x onerror="window.__xss=1">"';
    await jugar(page, [CORTA, VF_V]);
    await page.fill('.resp-escrita input', raro);
    await page.click('.resp-escrita button');
    await expect(page.locator('.veredicto')).toHaveClass(/fallo/);
    await page.click('#bSig');
    await page.click('#bAnt');
    await expect(page.locator('.resp-escrita input')).toHaveValue(raro);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('.resp-escrita img')).toHaveCount(0);
  });
  test('al volver a la pregunta se ve lo que escribió', async ({ page }) => {
    await jugar(page, [CORTA, VF_V]);
    await page.fill('.resp-escrita input', 'rom');
    await page.click('.resp-escrita button');
    await page.click('#bSig');
    await page.click('#bAnt');
    await expect(page.locator('.resp-escrita input')).toHaveValue('rom');
    await expect(page.locator('.resp-escrita input')).toBeDisabled();
    await expect(page.locator('.veredicto')).toHaveClass(/fallo/);
  });
});

test.describe('un banco con todos los tipos mezclados', () => {
  const MIXTO = [MC, VF_V, NUM, NUM_TOL, CORTA, VF_F];
  test('se juega entero, el resumen cuenta bien y se guarda con el formato correcto', async ({ page, servidor }) => {
    await jugar(page, MIXTO, { conCodigo: true });
    await expect(page.locator('#contador')).toHaveText('1/6');
    await page.click('.op.ok');                                    // mc: acierta
    await page.click('#bSig'); await page.click('.op[data-v="true"]');   // vf1: acierta
    await page.click('#bSig'); await page.fill('.resp-escrita input', '47'); await page.click('.resp-escrita button');          // n1: acierta
    await page.click('#bSig'); await page.fill('.resp-escrita input', '9'); await page.click('.resp-escrita button');           // n2: falla
    await page.click('#bSig'); await page.fill('.resp-escrita input', 'ram'); await page.click('.resp-escrita button');         // c1: acierta
    await page.click('#bSig'); await page.click('.op[data-v="true"]');   // vf2: falla (la buena es falso)
    await page.click('#bSig');
    await expect(page.locator('.final .num')).toContainText('6,7');
    await expect(page.locator('.rejilla button.mal')).toHaveCount(2);
    await expect(page.locator('.por-tipo .fila')).toHaveCount(4);
    await expect(page.locator('#guardado')).toContainText('Resultado guardado');
    await sinDesborde(page);

    const g = servidor.guardados[0];
    expect(g.p_datos).toMatchObject({ test: 'b', total: 6, aciertos: 4, nota: 6.7 });
    const por = Object.fromEntries(g.p_datos.respuestas.map(r => [r.id, r]));
    expect(Object.keys(por.mc).sort()).toEqual(['elegida', 'id', 'ms', 'ok']);       // opción múltiple: como siempre
    expect(por.mc.elegida).toBe(0);
    expect(Object.keys(por.vf1).sort()).toEqual(['dada', 'id', 'ms', 'ok']);         // el resto: `dada`
    expect(por.vf1.dada).toBe(true);
    expect(por.vf2).toMatchObject({ dada: true, ok: false });
    expect(por.n1).toMatchObject({ dada: '47', ok: true });
    expect(por.n2).toMatchObject({ dada: '9', ok: false });
    expect(por.c1).toMatchObject({ dada: 'ram', ok: true });
  });
  test('«Repetir las falladas» vuelve a pintar cada tipo con su pantalla', async ({ page }) => {
    await jugar(page, [VF_F, NUM, CORTA]);
    await page.click('.op[data-v="true"]');
    await page.click('#bSig'); await page.fill('.resp-escrita input', '1'); await page.click('.resp-escrita button');
    await page.click('#bSig'); await page.fill('.resp-escrita input', 'x'); await page.click('.resp-escrita button');
    await page.click('#bSig');
    await expect(page.locator('#bFalladas')).toContainText('3');
    await page.click('#bFalladas');
    await expect(page.locator('#contador')).toHaveText('1/3');
    await expect(page.locator('.op')).toHaveCount(2);
    await expect(page.locator('.resp-escrita')).toHaveCount(0);
    await page.click('.op[data-v="false"]'); await page.click('#bSig');
    await expect(page.locator('.resp-escrita input')).toBeEnabled();
  });
  test('ninguna pantalla se desborda en horizontal', async ({ page }) => {
    await jugar(page, [{ ...VF_V, code: 'print("hola")\nx = 1' }, NUM_TOL, CORTA]);
    await sinDesborde(page);
    await page.click('.op[data-v="true"]'); await sinDesborde(page);
    await page.click('#bSig'); await sinDesborde(page);
    await page.fill('.resp-escrita input', '3'); await page.click('.resp-escrita button'); await sinDesborde(page);
    await page.click('#bSig'); await sinDesborde(page);
  });
});
