/* Los RESULTADOS DEL DIRECTO en el panel del profesor (panel.html), a 1280 y a 390 px, con el Supabase falso del panel. Datos inventados. */
const { test, expect } = require('./fixtures');
const { crearServidorPanel, intentosDePrueba, datosDirecto, EMAIL, CLAVE } = require('./servidor-panel-falso');

const sinDesborde = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const visible = (page, sel) => page.locator(sel + ':visible').first();
async function abrir(page, servidor, extra = {}) {
  servidor.panel = await crearServidorPanel({ intentos: intentosDePrueba(), ...datosDirecto(), ...extra });
  await page.goto('panel.html');
  await page.fill('#iEmail', EMAIL); await page.fill('#iPass', CLAVE); await page.click('#bLogin');
  await expect(page.locator('.inicio-cab h1')).toBeVisible();
  return servidor.panel;
}
const aResultados = async page => { await page.locator('[data-di-res]:visible').first().click(); await expect(page.locator('.resumen')).toBeVisible(); };

test.describe('resultados del directo', () => {
  test('en el inicio del grupo salen sus salas jugadas (no las que no llegaron a empezar)', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await expect(page.locator('.directos-grupo')).toContainText('Directo U1');
    await expect(page.locator('.directos-grupo')).not.toContainText('Sala que no empezó');
    await sinDesborde(page);
  });

  test('clasificación: posición, apodo, puntos, aciertos y quién no entró', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    const filas = page.locator('.fila-di:visible');
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText('Zorro Azul');
    await expect(filas.nth(0)).toContainText('1900');
    await expect(filas.nth(0)).toContainText('2/3');
    await expect(filas.nth(1)).toContainText('Lince Verde');
    await expect(filas.nth(1)).toContainText('1 de 3'.replace(' de ', '/'));
    await expect(page.locator('.resumen')).toContainText('2');
    await expect(page.locator('.faltan-di')).toContainText('No entraron (1)');
    await expect(page.locator('.faltan-di')).toContainText('03');
    await sinDesborde(page);
  });

  test('pulsar un alumno enseña lo que contestó en cada pregunta, la correcta y los puntos', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await visible(page, '[data-al="TDA2-01"]').click();
    const modal = page.locator('#cuerpoDetalle');
    await expect(page.locator('#tituloDetalle')).toContainText('Zorro Azul');
    await expect(modal).toContainText('Primera del directo');
    await expect(modal).toContainText('950');
    await expect(modal.locator('.pfila').nth(2)).toContainText('CONTESTÓ');
    await expect(modal.locator('.pfila').nth(2)).toContainText('b');          // falló la tercera: puso la b
    await expect(modal.locator('.pfila').nth(2)).toContainText('c');          // y la correcta era la c
    await sinDesborde(page);
  });

  test('un alumno que no contestó una pregunta: «sin contestar»', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await visible(page, '[data-al="TDA2-02"]').click();
    await expect(page.locator('#cuerpoDetalle .pfila').nth(2)).toContainText('no contestó a tiempo');
  });

  test('preguntas: la más fallada primero, con la respuesta equivocada más elegida y el reparto', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await page.locator('.tabs button[data-t="preguntas"]').click();
    const filas = page.locator('.pfila');
    await expect(filas).toHaveCount(3);
    await expect(filas.nth(0)).toContainText('Tercera del directo');       // 100 % de fallo
    await expect(filas.nth(0)).toContainText('100%');
    await expect(filas.nth(0)).toContainText('LA RESPUESTA EQUIVOCADA MÁS ELEGIDA');
    await expect(filas.nth(1)).toContainText('Primera del directo');       // 50 %
    await expect(filas.nth(1)).toContainText('50%');
    await expect(filas.nth(2)).toContainText('Segunda del directo');       // 0 %
    await expect(filas.nth(2)).toContainText('0%');
    await sinDesborde(page);
  });

  test('criterios: el acierto de la clase por criterio (no contestar cuenta como fallo)', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await page.locator('.tabs button[data-t="criterios"]').click();
    const filas = page.locator('.tabla-ex tbody tr');
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText('2.1');
    await expect(filas.nth(0)).toContainText('75 %');
    await expect(filas.nth(1)).toContainText('2.2');
    await expect(filas.nth(1)).toContainText('0 %');
    await sinDesborde(page);
  });

  test('descargar para Excel: una fila por jugador con puntos y acierto de cada pregunta', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#bExcelDi')]);
    expect(d.suggestedFilename()).toMatch(/^directo_TDA2_123456_\d{4}-\d\d-\d\d\.csv$/);
    const csv = require('fs').readFileSync(await d.path(), 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const lineas = csv.slice(1).split('\r\n');
    expect(lineas[0]).toBe('Pos.;Apodo;Nº;Nombre;Puntos;Aciertos;Total;Tiempo medio (s);Sin contestar;P1 (2.1);P2 (2.1);P3 (2.2)');
    expect(lineas[1]).toBe('1;Zorro Azul;01;;1900;2;3;4,7;0;1;1;0');
    expect(lineas[2]).toBe('2;Lince Verde;02;;900;1;3;6,5;1;0;1;');
  });

  test('borrar la sala pide confirmación, la borra y vuelve al inicio sin ella', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aResultados(page);
    await page.click('#bBorrarDi');
    await expect(page.locator('#dialogo')).toBeVisible();
    await page.click('#dlgNo');
    expect(S.llamadas.filter(l => l.fn === 'profe_directo_borrar')).toHaveLength(0);
    await page.click('#bBorrarDi'); await page.click('#dlgSi');
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    expect(S.llamadas.filter(l => l.fn === 'profe_directo_borrar')).toEqual([{ fn: 'profe_directo_borrar', args: { p_sesion: 'dddddddd-0000-4000-8000-000000000001' } }]);
    await expect(page.locator('.directos-grupo')).toHaveCount(0);
    expect(S.directo_respuestas).toHaveLength(0);
  });

  test('sin el SQL 09 en la base, el panel funciona como siempre (sin sección de directos)', async ({ page, servidor }) => {
    servidor.panel = await crearServidorPanel({ intentos: intentosDePrueba(), ...datosDirecto() });
    servidor.panel.sinDirecto = true;                                  // las tablas directo_* no existen todavía
    await page.goto('panel.html');
    await page.fill('#iEmail', EMAIL); await page.fill('#iPass', CLAVE); await page.click('#bLogin');
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    await expect(page.locator('.directos-grupo')).toHaveCount(0);
    await expect(page.locator('.grupo').first()).toBeVisible();
  });

  test('sin errores de JavaScript en una visita completa', async ({ page, servidor }) => {
    const errores = []; page.on('pageerror', e => errores.push(e.message));
    await abrir(page, servidor); await aResultados(page);
    for (const t of ['preguntas', 'criterios', 'alumnos']) { await page.locator('.tabs button[data-t="' + t + '"]').click(); }
    expect(errores).toEqual([]);
  });
});
