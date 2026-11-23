/* El PANEL del profesor (panel.html), a 1280 y a 390 px, con el Supabase falso de pruebas/servidor-panel-falso.js.
   Datos inventados. Nunca se toca el Supabase real. */
const { test, expect } = require('./fixtures');
const { crearServidorPanel, intentosDePrueba, EMAIL, CLAVE } = require('./servidor-panel-falso');

const sinDesborde = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const visible = (page, sel) => page.locator(sel + ':visible').first();
// El bloque de un grupo por el TÍTULO EXACTO («TDA I» no es «TDA II»)
const grupo = (page, nombre) => page.locator('.grupo', { has: page.locator('h2', { hasText: new RegExp('^' + nombre + '$') }) });

async function abrir(page, servidor, datos = {}, { entrar = true } = {}) {
  servidor.panel = await crearServidorPanel({ intentos: intentosDePrueba(), ...datos });
  await page.goto('panel.html');
  if (entrar) await iniciarSesion(page);
  return servidor.panel;
}
async function iniciarSesion(page, email = EMAIL, clave = CLAVE) {
  await page.fill('#iEmail', email); await page.fill('#iPass', clave); await page.click('#bLogin');
}

test.describe('entrar y salir', () => {
  test('pide correo y contraseña; si son malos lo dice; si son buenos entra y saluda', async ({ page, servidor }) => {
    await abrir(page, servidor, {}, { entrar: false });
    await expect(page.locator('#fLogin')).toBeVisible();
    await sinDesborde(page);
    await iniciarSesion(page, EMAIL, 'mala');
    await expect(page.locator('#msgLogin')).toContainText('Correo o contraseña incorrectos');
    await expect(page.locator('#bLogin')).toBeEnabled();
    await page.fill('#iPass', CLAVE); await page.click('#bLogin');
    await expect(page.locator('.inicio-cab h1')).toContainText('Hola');
    await expect(page.locator('#usuario')).toContainText(EMAIL);
  });
  test('sin conexión al entrar: lo dice', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, {}, { entrar: false });
    S.red = false; await iniciarSesion(page);
    await expect(page.locator('#msgLogin')).toContainText('No hay conexión');
  });
  test('«Salir» vuelve al acceso y olvida la sesión; recargar la página no entra solo', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    await page.click('#bSalir');
    await expect(page.locator('#msgLogin')).toContainText('Has salido');
    await page.reload();
    await expect(page.locator('#fLogin')).toBeVisible();
  });
  test('pulsar «Salir» mientras todavía carga no deja el panel roto (no se pinta nada encima del acceso)', async ({ page, servidor }) => {
    const errores = []; page.on('pageerror', e => errores.push(e.message));
    const S = await abrir(page, servidor, {}, { entrar: false });
    S.latencia = 700;                                    // la carga tarda: da tiempo a pulsar «Salir» en medio
    await iniciarSesion(page);
    await page.click('#bSalir');
    await expect(page.locator('#msgLogin')).toContainText('Has salido');
    await page.waitForTimeout(2500);                     // …y se espera a que terminen las peticiones que estaban en marcha
    await expect(page.locator('#fLogin')).toBeVisible();
    await expect(page.locator('.inicio-cab')).toHaveCount(0);
    expect(errores).toEqual([]);
  });
  test('la sesión se recuerda al recargar (hasta pulsar «Salir»)', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    await page.reload();
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    await expect(page.locator('#fLogin')).toHaveCount(0);
  });
  test('un correo que no es de profesor: explica cómo darlo de alta', async ({ page, servidor }) => {
    const S = await crearServidorPanel({ intentos: intentosDePrueba() }); S.noEsProfesor = true; servidor.panel = S;
    await page.goto('panel.html'); await iniciarSesion(page);
    await expect(page.locator('#app')).toContainText('no está dado de alta como profesor');
    await expect(page.locator('#app code')).toContainText("insert into public.profesores(email) values ('" + EMAIL + "')");
  });
  test('sesión caducada: se renueva sola sin molestar', async ({ page, servidor }) => {
    const S = await abrir(page, servidor);
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    S.sesionCaducada();
    await page.click('#bRecargar');
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    expect(S.peticiones.some(p => p.ruta.includes('grant_type=refresh_token'))).toBe(true);
  });
  test('sesión caducada y no se puede renovar: pide entrar otra vez', async ({ page, servidor }) => {
    const S = await abrir(page, servidor);
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    S.sesionCaducada(); S.refrescoFalla = true;
    await page.click('#bRecargar');
    await expect(page.locator('#msgLogin')).toContainText('Tu sesión ha caducado');
  });
});

test.describe('inicio: grupos y tests', () => {
  test('cada grupo con sus tests, cuántos lo han hecho, la nota media y los intentos', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await expect(page.locator('.grupo')).toHaveCount(2);
    const tda2 = grupo(page, 'TDA II');
    await expect(tda2.locator('.test-card')).toHaveCount(1);
    await expect(tda2.locator('.tc-tit')).toContainText('Práctica U1');
    await expect(tda2.locator('.tc-datos')).toContainText('2/3');          // lo han hecho 2 de 3 alumnos
    await expect(tda2.locator('.tc-datos')).toContainText('8,8');          // media de los mejores: (7,5 + 10) / 2
    await expect(tda2.locator('.tc-datos')).toContainText('3');            // intentos
    await expect(grupo(page, 'TDA I').locator('.tc-tit')).toContainText('Repaso U1 y U2');
    await sinDesborde(page);
  });
  test('arriba: resumen de la semana y tres accesos (Directo, Exámenes, Tests de repaso)', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await expect(page.locator('.resumen-inicio .regla')).toHaveCount(3);
    await expect(page.locator('.resumen-inicio')).toContainText('alumnos activos esta semana');
    await expect(page.locator('.accesos .acceso.directo')).toHaveAttribute('href', 'directo.html');
    await expect(page.locator('#bAccRepaso')).toBeVisible();
    await sinDesborde(page);
    await page.click('#bAccRepaso');
    await expect(page.locator('.grupo').first()).toBeVisible();
  });
  test('«▶ Probar» abre el modo profe por el enlace antiguo test.html; «🔗 Enlace» es el de los alumnos', async ({ page, servidor }) => {
    await abrir(page, servidor);
    const probar = grupo(page, 'TDA II').locator('a.btn', { hasText: 'Probar' });
    expect(await probar.getAttribute('href')).toBe('test.html?t=tda2-u1-python-practica&modo=profe');
    expect(await probar.getAttribute('target')).toBe('_blank');
    const enlace = await grupo(page, 'TDA II').locator('[data-copiar]').getAttribute('data-copiar');
    expect(enlace).toMatch(/\/test\.html$/);                                // el test por defecto: sin ?t
    const enlace1 = await grupo(page, 'TDA I').locator('[data-copiar]').getAttribute('data-copiar');
    expect(enlace1).toMatch(/\/test\.html\?t=tda1-u1u2-repaso$/);
  });
  test('nunca pide los códigos de los alumnos (ni select=*)', async ({ page, servidor }) => {
    const S = await abrir(page, servidor);
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    expect(S.peticiones.filter(p => /select=\*|codigo_hash/.test(p.ruta))).toEqual([]);
    expect(S.peticiones.some(p => p.ruta.includes('/rest/v1/alumnos?select=id,grupo,activo'))).toBe(true);
  });
});

test.describe('resultados de un test', () => {
  async function aResultados(page, servidor, datos) {
    const S = await abrir(page, servidor, datos);
    await grupo(page, 'TDA II').locator('[data-res]').click();
    await expect(page.locator('.resumen')).toBeVisible();
    return S;
  }
  test('resumen y alumnos: quién lo ha hecho y con qué notas', async ({ page, servidor }) => {
    await aResultados(page, servidor);
    await expect(page.locator('.resumen .regla').first()).toContainText('2/3');
    await expect(page.locator('.resumen')).toContainText('8,8');           // nota media (mejor intento)
    await expect(page.locator('.resumen')).toContainText('7,5');           // nota media (primer intento): (5 + 10) / 2
    const fila = visible(page, '[data-id="TDA2-01"]');
    await expect(fila).toContainText('2');
    await expect(fila).toContainText('7,5');
    await expect(visible(page, '[data-id="TDA2-03"]')).toContainText('sin hacer');
    await sinDesborde(page);
  });
  test('cambiar de grupo cambia de test; «← Inicio» vuelve', async ({ page, servidor }) => {
    await aResultados(page, servidor);
    await page.selectOption('#sGrupo', 'TDA1');
    await expect(page.locator('#sTest')).toHaveValue('tda1-u1u2-repaso');
    await expect(visible(page, '[data-id="TDA1-01"]')).toContainText('2,5');
    await page.click('#bInicio');
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
  });
  test('ordenar por una columna (escritorio)', async ({ page, servidor }) => {
    test.skip(test.info().project.name === 'movil', 'en móvil se ve una lista, no la tabla');
    await aResultados(page, servidor);
    const nums = async () => page.locator('tbody tr .num').allTextContents();
    expect(await nums()).toEqual(['01', '02', '03']);
    await page.click('th[data-c="mejor"]');               // la primera pulsación ordena de mayor a menor (los «sin hacer» siempre al final)
    expect(await nums()).toEqual(['02', '01', '03']);
    await page.click('th[data-c="mejor"]');               // la segunda, de menor a mayor
    expect(await nums()).toEqual(['01', '02', '03']);
  });
  test('pestaña «Preguntas más falladas»: porcentaje y respuesta equivocada más elegida', async ({ page, servidor }) => {
    await aResultados(page, servidor);
    await page.click('.tabs button[data-v="preguntas"]');
    await expect(page.locator('.pfila').first()).toBeVisible();
    await expect(page.locator('.pfila').first().locator('.pct')).toContainText('%');
    await expect(page.locator('.pfila').first()).toContainText('Q01');          // la más fallada de las contestadas
    await page.selectOption('#sCuenta', 'primero');
    await expect(page.locator('.pfila').first()).toBeVisible();
  });
  test('exportar para Excel: CSV con BOM, punto y coma y una fila por alumno', async ({ page, servidor }) => {
    await aResultados(page, servidor);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#bExcel')]);
    expect(descarga.suggestedFilename()).toMatch(/^TDA2_tda2-u1-python-practica_\d{4}-\d\d-\d\d\.csv$/);
    const texto = require('fs').readFileSync(await descarga.path(), 'utf8');
    expect(texto.charCodeAt(0)).toBe(0xFEFF);
    const lineas = texto.slice(1).split('\r\n');
    expect(lineas[0]).toBe('Nº;Nombre;Intentos;Mejor nota;Primera nota;Última nota;Nota media;Tiempo último intento;Tiempo total;Fecha último intento');
    expect(lineas).toHaveLength(4);
    expect(lineas[1].startsWith('01;;2;7,5;5,0;7,5;6,3;')).toBe(true);
  });
});

test.describe('detalle de un alumno', () => {
  async function aDetalle(page, servidor) {
    const S = await abrir(page, servidor);
    await grupo(page, 'TDA II').locator('[data-res]').click();
    await visible(page, '[data-id="TDA2-01"]').click();
    await expect(page.locator('#capaDetalle')).toHaveClass(/on/);
    return S;
  }
  test('sus intentos, de más reciente a más antiguo, con el mapa de preguntas', async ({ page, servidor }) => {
    await aDetalle(page, servidor);
    await expect(page.locator('#tituloDetalle')).toContainText('Nº 01');
    await expect(page.locator('.intento')).toHaveCount(2);
    await expect(page.locator('.intento').first()).toContainText('Intento 2');
    await expect(page.locator('.intento').first().locator('.mapa button')).toHaveCount(4);
    await expect(page.locator('.intento').first().locator('.mapa button.mal')).toHaveCount(1);
    await sinDesborde(page);
  });
  test('pulsar una casilla enseña la pregunta con lo que eligió y cuánto tardó', async ({ page, servidor }) => {
    await aDetalle(page, servidor);
    await page.locator('.intento').first().locator('.mapa button').first().click();
    const ver = page.locator('.intento').first().locator('.ver-p');
    await expect(ver).toBeVisible();
    await expect(ver.locator('.op-mini')).toHaveCount(4);
    await expect(ver).toContainText('Tardó');
  });
  test('borrar un intento pide confirmación y lo borra de verdad', async ({ page, servidor }) => {
    const S = await aDetalle(page, servidor);
    await page.locator('.intento').first().locator('[data-borrar]').click();
    await expect(page.locator('#dialogo')).toBeVisible();
    await page.click('#dlgNo');                                          // «Cancelar»: no se borra nada
    expect(S.intentos.filter(i => i.alumno === 'TDA2-01')).toHaveLength(2);
    await page.locator('.intento').first().locator('[data-borrar]').click();
    await page.click('#dlgSi');
    await expect.poll(() => S.intentos.filter(i => i.alumno === 'TDA2-01').length).toBe(1);
    expect(S.peticiones.some(p => p.metodo === 'DELETE' && p.ruta.includes('intentos?id=eq.2'))).toBe(true);
    await expect(page.locator('.intento')).toHaveCount(1);
  });
  test('un alumno que no ha hecho el test: lo dice', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await grupo(page, 'TDA II').locator('[data-res]').click();
    await visible(page, '[data-id="TDA2-03"]').click();
    await expect(page.locator('#cuerpoDetalle')).toContainText('Todavía no ha hecho este test');
    await page.keyboard.press('Escape');
    await expect(page.locator('#capaDetalle')).not.toHaveClass(/on/);
  });
});

test.describe('nombres desde tu archivo (solo en este navegador)', () => {
  const CSV = '﻿numero;nombre;codigo\r\nTDA2-01;Alumno Inventado Uno;AAA222\r\nTDA2-02;Alumna Inventada Dos;BBB333\r\n';
  async function aResultados(page, servidor) {
    const S = await abrir(page, servidor);
    await grupo(page, 'TDA II').locator('[data-res]').click();
    return S;
  }
  test('carga los nombres, los enseña y se pueden olvidar; nada de eso viaja a ningún servidor', async ({ page, servidor }) => {
    const S = await aResultados(page, servidor);
    await expect(page.locator('.aviso-nombres')).toBeVisible();
    await page.setInputFiles('#iCSV', { name: 'TDA2_alumnos.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
    await expect(visible(page, '[data-id="TDA2-01"]')).toContainText('Alumno Inventado Uno');
    await expect(page.locator('.nombres-ok')).toBeVisible();
    // ni los nombres ni los códigos salen del navegador
    const todo = JSON.stringify(S.peticiones);
    for (const dato of ['Alumno Inventado', 'Alumna Inventada', 'AAA222', 'BBB333']) expect(todo).not.toContain(dato);
    expect(await page.evaluate(() => localStorage.getItem('pt_nombres'))).not.toContain('AAA222');   // el código no se guarda ni en el navegador
    await page.click('#bOlvidar');
    await expect(page.locator('.aviso-nombres')).toBeVisible();
    await expect(visible(page, '[data-id="TDA2-01"]')).not.toContainText('Alumno Inventado');
  });
  test('los nombres sobreviven a una recarga (viven en este navegador)', async ({ page, servidor }) => {
    await aResultados(page, servidor);
    await page.setInputFiles('#iCSV', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
    await page.reload();
    await grupo(page, 'TDA II').locator('[data-res]').click();
    await expect(visible(page, '[data-id="TDA2-01"]')).toContainText('Alumno Inventado Uno');
  });
});
