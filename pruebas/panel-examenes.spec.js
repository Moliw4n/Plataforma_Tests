/* Los EXÁMENES en el panel del profesor (panel.html), a 1280 y a 390 px, con el Supabase falso del panel. Datos inventados. */
const { test, expect } = require('./fixtures');
const { crearServidorPanel, intentosDePrueba, datosExamen, EMAIL, CLAVE } = require('./servidor-panel-falso');
const { bancoDePrueba } = require('./servidor-examen-falso');
const fs = require('fs');

const sinDesborde = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const visible = (page, sel) => page.locator(sel + ':visible').first();
const grupo = (page, nombre) => page.locator('.grupo', { has: page.locator('h2', { hasText: new RegExp('^' + nombre + '$') }) });

async function abrir(page, servidor, { examen = true, extra = {} } = {}) {
  servidor.panel = await crearServidorPanel({ intentos: intentosDePrueba(), ...(examen ? datosExamen() : {}), ...extra });
  await page.goto('panel.html');
  await page.fill('#iEmail', EMAIL); await page.fill('#iPass', CLAVE); await page.click('#bLogin');
  await expect(page.locator('.inicio-cab h1')).toBeVisible();
  return servidor.panel;
}
const aGestion = async page => { await page.click('#bGestion'); await expect(page.locator('.tit-ex')).toBeVisible(); };
const aResultados = async page => { await grupo(page, 'TDA II').locator('[data-ex-res]').click(); await expect(page.locator('.banda-notas')).toBeVisible(); };
const archivo = (obj, nombre = 'banco.json') => ({ name: nombre, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8') });
const rpcs = (S, fn) => S.llamadas.filter(l => l.fn === fn);

test.describe('si todavía no se han ejecutado los SQL de exámenes', () => {
  test('el panel funciona exactamente como antes: sin botón de exámenes ni errores', async ({ page, servidor }) => {
    const S = await crearServidorPanel({ intentos: intentosDePrueba() }); S.sinExamenes = true; servidor.panel = S;
    const errores = []; page.on('pageerror', e => errores.push(e.message));
    await page.goto('panel.html'); await page.fill('#iEmail', EMAIL); await page.fill('#iPass', CLAVE); await page.click('#bLogin');
    await expect(page.locator('.inicio-cab h1')).toBeVisible();
    await expect(page.locator('#bGestion')).toHaveCount(0);
    await expect(page.locator('.examenes-grupo')).toHaveCount(0);
    await expect(grupo(page, 'TDA II').locator('.tc-datos')).toContainText('2/3');           // los tests de siempre, intactos
    expect(errores).toEqual([]);
  });
});

test.describe('inicio', () => {
  test('el grupo con examen asignado lo enseña (estado, preguntas, minutos, notas ocultas); el otro no', async ({ page, servidor }) => {
    await abrir(page, servidor);
    const g = grupo(page, 'TDA II');
    await expect(g.locator('.examenes-grupo h3')).toHaveText('Exámenes');
    const c = g.locator('.examen-card');
    await expect(c).toHaveCount(1);
    await expect(c.locator('.tc-tit')).toContainText('Examen U1 · Python');
    await expect(c.locator('.tc-tit')).toContainText('Abierto');
    await expect(c.locator('.tc-datos')).toContainText('20');
    await expect(c.locator('.tc-datos')).toContainText('30');
    await expect(c.locator('.estado-notas')).toHaveText('Notas ocultas');
    expect(await c.locator('[data-ex-enlace]').getAttribute('data-ex-enlace')).toMatch(/\/jugar\.html\?j=ex1$/);
    await expect(grupo(page, 'TDA I').locator('.examenes-grupo')).toHaveCount(0);
    await sinDesborde(page);
  });
  test('estado según las fechas: aún no abierto, cerrado', async ({ page, servidor }) => {
    const d = datosExamen(); d.asignaciones[0].desde = new Date(Date.now() + 3600e3).toISOString();
    await abrir(page, servidor, { examen: false, extra: d });
    await expect(page.locator('.examen-card .tc-tit')).toContainText('Aún no abierto');
  });
});

test.describe('el enlace del examen', () => {
  test('en el entorno de pruebas el enlace lleva &entorno=pruebas (y en producción, no)', async ({ page, servidor }) => {
    await abrir(page, servidor);
    const enlace = () => grupo(page, 'TDA II').locator('[data-ex-enlace]').getAttribute('data-ex-enlace');
    expect(await enlace()).toMatch(/\/jugar\.html\?j=ex1$/);
    await page.evaluate(() => { window.ENTORNO = 'pruebas'; });
    await page.click('#bRecargar');
    await expect(grupo(page, 'TDA II').locator('[data-ex-enlace]')).toHaveAttribute('data-ex-enlace', /\/jugar\.html\?j=ex1&entorno=pruebas$/);
  });
});

test.describe('subir un banco', () => {
  test('un banco válido: pide confirmación con el resumen y lo sube con sus soluciones al servidor', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    await page.setInputFiles('#iBanco', archivo(bancoDePrueba()));
    await expect(page.locator('#dialogo')).toBeVisible();
    await expect(page.locator('#dlgTexto')).toContainText('«Banco grande» con 12 preguntas');
    await expect(page.locator('#dlgSi')).toHaveText('Subir');
    await page.click('#dlgSi');
    await expect(page.locator('#msgBanco')).toContainText('Banco «grande» subido: 12 preguntas (versión 1)');
    await expect(page.locator('#secBancos')).toContainText('grande');
    const [llamada] = rpcs(S, 'profe_subir_banco');
    expect(llamada.args.p_banco.formato).toBe(2);
    expect(llamada.args.p_banco.preguntas).toHaveLength(12);
    expect(JSON.stringify(llamada.args)).toContain('SOLUCION-t1mc');                       // las soluciones SÍ van al servidor…
    const guardado = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
    expect(guardado).not.toContain('SOLUCION-');                                           // …y no se quedan en el navegador
  });
  test('cancelar no sube nada', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    await page.setInputFiles('#iBanco', archivo(bancoDePrueba()));
    await page.click('#dlgNo');
    expect(rpcs(S, 'profe_subir_banco')).toHaveLength(0);
  });
  test('un archivo que no es JSON, o un banco con problemas: lo dice y no sube nada', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    await page.setInputFiles('#iBanco', archivo('esto no es json', 'raro.json'));
    await expect(page.locator('#msgBanco')).toContainText('no es un JSON válido');
    const roto = bancoDePrueba(); delete roto.preguntas[0].sol; roto.preguntas[1].ok = 'x'; roto.preguntas[2].tipo = 'adivinanza';
    await page.setInputFiles('#iBanco', archivo(roto));
    await expect(page.locator('#msgBanco')).toContainText('no se ha subido nada');
    await expect(page.locator('#msgBanco')).toContainText('falta «sol»');
    await expect(page.locator('#msgBanco')).toContainText('desconocido');
    await expect(page.locator('#dialogo')).toBeHidden();
    expect(rpcs(S, 'profe_subir_banco')).toHaveLength(0);
  });
  test('un banco en el formato antiguo se convierte solo al subirlo', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    const viejo = { id: 'viejo', titulo: 'Banco viejo', preguntas: [{ id: 'a', tipo: 'imprime', act: 'A1', enun: 'e', ops: ['1', '2', '3', '4'], ok: 0, sol: 's', trampa: 't' }] };
    await page.setInputFiles('#iBanco', archivo(viejo));
    await page.click('#dlgSi');
    await expect(page.locator('#msgBanco')).toContainText('subido');
    const p = rpcs(S, 'profe_subir_banco')[0].args.p_banco;
    expect(p.formato).toBe(2); expect(p.preguntas[0]).toMatchObject({ tipo: 'opcion_multiple', categoria: 'imprime' });
  });
  test('si el banco ya existe, avisa de que se reemplaza; si el servidor dice «en uso», lo explica', async ({ page, servidor }) => {
    const d = datosExamen(); const S = await abrir(page, servidor, { examen: false, extra: { ...d, bancos: [{ id: 'grande', titulo: 'Banco grande', version: 1 }] } });
    await aGestion(page);
    S.bancoEnUso = 'grande';
    await page.setInputFiles('#iBanco', archivo(bancoDePrueba()));
    await expect(page.locator('#dlgTexto')).toContainText('se REEMPLAZARÁ');
    await page.click('#dlgSi');
    await expect(page.locator('#msgBanco')).toContainText('ya lo usa algún examen');
    await expect(page.locator('#msgBanco')).toContainText('otro id');
  });
  test('borrar un banco pide confirmación; si lo usa un examen, lo explica', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    await page.click('[data-borrar-banco="u1"]');
    await expect(page.locator('#dlgTexto')).toContainText('«u1»');
    await page.click('#dlgSi');
    await expect(page.locator('#msgBanco')).toContainText('ya lo usa algún examen');
    expect(S.bancos).toHaveLength(1);
  });
});

test.describe('crear un examen y ponérselo a un grupo', () => {
  test('crear: manda las reglas elegidas y avisa de que falta ponerlo a un grupo', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, { examen: false, extra: { bancos: datosExamen().bancos } }); await aGestion(page);
    await page.fill('#jId', 'nuevo-examen'); await page.fill('#jTitulo', 'Mi examen'); await page.check('.jBanco');
    await page.fill('#jPreg', '12'); await page.fill('#jMin', '45'); await page.selectOption('#jPen', '0.25'); await page.selectOption('#jEq', 'ninguno');
    await page.click('#bCrearJuego');
    await expect(page.locator('#msgJuego')).toContainText('«nuevo-examen» creado');
    expect(rpcs(S, 'profe_crear_juego')[0].args.p_juego).toEqual({ id: 'nuevo-examen', modo: 'examen', titulo: 'Mi examen', bancos: ['u1'], reglas: { preguntas: 12, tiempo_min: 45, penalizacion: 0.25, equilibrar: 'ninguno' } });
    await expect(page.locator('#secAsignar')).toContainText('Mi examen');
  });
  test('sin elegir banco no se manda nada; un error del servidor sale en claro', async ({ page, servidor }) => {
    const S = await abrir(page, servidor, { examen: false, extra: { bancos: datosExamen().bancos } }); await aGestion(page);
    await page.fill('#jId', 'x'); await page.fill('#jTitulo', 'X');
    await page.click('#bCrearJuego');
    await expect(page.locator('#msgJuego')).toContainText('Elige al menos un banco');
    expect(rpcs(S, 'profe_crear_juego')).toHaveLength(0);
  });
  test('asignar: manda grupo, fechas en ISO, intentos y soluciones, y da el enlace para los alumnos', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    await page.selectOption('#aGrupo', 'TDA1'); await page.check('#aFechas'); await page.fill('#aDesde', '2026-11-25T09:00'); await page.fill('#aHasta', '2026-11-25T10:30'); await page.fill('#aInt', '2'); await page.check('#aSol');
    await page.click('#bAsignar');
    await expect(page.locator('#msgAsignar')).toContainText('/jugar.html?j=ex1');
    const a = rpcs(S, 'profe_asignar')[0].args;
    expect(a).toMatchObject({ p_juego: 'ex1', p_grupo: 'TDA1', p_intentos: 2, p_mostrar_soluciones: true });
    expect(new Date(a.p_desde).getTime()).toBe(new Date('2026-11-25T09:00').getTime());
    expect(new Date(a.p_hasta).getTime()).toBe(new Date('2026-11-25T10:30').getTime());
    await expect(page.locator('#secAsignar table')).toContainText('TDA1');
  });
  test('las fechas solo existen si se marca la casilla: por defecto, sin límite (aunque el navegador enseñe un relleno)', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    await expect(page.locator('#aDesde')).toBeHidden(); await expect(page.locator('#aHasta')).toBeHidden();
    await page.fill('#aInt', '2');
    await page.click('#bAsignar');
    await expect(page.locator('#msgAsignar')).toContainText('/jugar.html?j=ex1');
    expect(rpcs(S, 'profe_asignar')[0].args).toMatchObject({ p_desde: null, p_hasta: null, p_intentos: 2 });
  });
  test('al marcar la casilla salen las dos fechas con valores razonables; al desmarcarla se ignoran aunque estén rellenas', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aGestion(page);
    await page.check('#aFechas');
    await expect(page.locator('#aDesde')).toBeVisible(); await expect(page.locator('#aHasta')).toBeVisible();
    const [desde, hasta] = [await page.inputValue('#aDesde'), await page.inputValue('#aHasta')];
    expect(desde).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
    expect(new Date(hasta) - new Date(desde)).toBe(2 * 3600e3);
    await page.uncheck('#aFechas');
    await expect(page.locator('#aDesde')).toBeHidden();
    await page.click('#bAsignar');
    await expect.poll(() => rpcs(S, 'profe_asignar').length).toBe(1);
    expect(rpcs(S, 'profe_asignar')[0].args).toMatchObject({ p_desde: null, p_hasta: null });
  });
  test('en móvil, la gestión no se desborda', async ({ page, servidor }) => {
    await abrir(page, servidor); await aGestion(page); await sinDesborde(page);
  });
});

test.describe('resultados de un examen', () => {
  test('resumen, aviso de notas ocultas y alumnos con su estado, nota y salidas de pestaña', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await expect(page.locator('.banda-notas')).toContainText('todavía NO ven su nota');
    await expect(page.locator('.resumen .regla').first()).toContainText('1/3');
    await expect(page.locator('.resumen')).toContainText('7,5');
    const e1 = visible(page, '[data-id="TDA2-01"]');
    await expect(e1).toContainText('entregado', { ignoreCase: true }); await expect(e1).toContainText('7,5');      // en móvil el estado sale en minúsculas
    await expect(visible(page, '[data-id="TDA2-02"]')).toContainText('en curso', { ignoreCase: true });
    await expect(visible(page, '[data-id="TDA2-03"]')).toContainText('sin empezar', { ignoreCase: true });
    if (test.info().project.name !== 'movil') {
      await expect(e1.locator('.salidas')).toHaveText('2');
      await expect(e1).toContainText('42');
    }
    await sinDesborde(page);
  });
  test('pulsar un alumno: sus salidas de pestaña, el mapa de preguntas (bien, mal, en blanco) y la pregunta al pulsar', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await visible(page, '[data-id="TDA2-01"]').click();
    await expect(page.locator('#capaDetalle')).toHaveClass(/on/);
    await expect(page.locator('#tituloDetalle')).toContainText('Nº 01');
    await expect(page.locator('.eventos-ex')).toContainText('Salió de la pestaña 2 veces (42 s fuera)');
    await expect(page.locator('.mapa button')).toHaveCount(4);
    await expect(page.locator('.mapa button.ok')).toHaveCount(3); await expect(page.locator('.mapa button.mal')).toHaveCount(1);
    await page.locator('.mapa button').nth(2).click();
    await expect(page.locator('.ver-p')).toContainText('Falló');
    await sinDesborde(page);
  });
  test('un alumno con partida en curso y preguntas en blanco', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await visible(page, '[data-id="TDA2-02"]').click();
    await expect(page.locator('.mapa button.blanco')).toHaveCount(3);
    await expect(page.locator('.eventos-ex')).toContainText('Recargó la página 1');
    await expect(page.locator('#cuerpoDetalle')).toContainText('sin terminar');
  });
  test('un alumno que no ha empezado: lo dice', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await visible(page, '[data-id="TDA2-03"]').click();
    await expect(page.locator('#cuerpoDetalle')).toContainText('Todavía no ha empezado');
  });
  test('anular una partida pide confirmación, la anula en el servidor y deja al alumno sin empezar', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aResultados(page);
    await visible(page, '[data-id="TDA2-01"]').click();
    await page.click('[data-anular]');
    await expect(page.locator('#dlgTexto')).toContainText('Se borran sus respuestas');
    await page.click('#dlgNo');
    expect(rpcs(S, 'profe_borrar_partida')).toHaveLength(0);
    await page.click('[data-anular]'); await page.click('#dlgSi');
    await expect.poll(() => rpcs(S, 'profe_borrar_partida').length).toBe(1);
    expect(rpcs(S, 'profe_borrar_partida')[0].args.p_id).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    await expect(visible(page, '[data-id="TDA2-01"]')).toContainText('sin empezar', { ignoreCase: true });
    await expect(page.locator('#capaDetalle')).not.toHaveClass(/on/);
  });
  test('publicar y ocultar las notas (con confirmación)', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aResultados(page);
    await page.click('#bPublicar');
    await expect(page.locator('#dlgTexto')).toContainText('podrán ver la suya');
    await page.click('#dlgNo');
    expect(rpcs(S, 'profe_publicar_notas')).toHaveLength(0);
    await page.click('#bPublicar'); await page.click('#dlgSi');
    await expect(page.locator('.banda-notas')).toContainText('YA ven su nota');
    expect(rpcs(S, 'profe_publicar_notas')[0].args).toEqual({ p_asignacion: 1, p_publicar: true });
    await page.click('#bPublicar'); await page.click('#dlgSi');
    await expect(page.locator('.banda-notas')).toContainText('todavía NO ven');
    expect(rpcs(S, 'profe_publicar_notas')[1].args).toEqual({ p_asignacion: 1, p_publicar: false });
    await page.click('#bInicio');                                                           // y el inicio lo refleja
    await expect(grupo(page, 'TDA II').locator('.estado-notas')).toHaveText('Notas ocultas');
  });
  test('pestaña de preguntas: la más fallada primero, con su reparto y la respuesta equivocada más elegida', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    await page.click('.tabs button[data-t="preguntas"]');
    await expect(page.locator('.pfila')).toHaveCount(3);
    const primera = page.locator('.pfila').first();
    await expect(primera).toContainText('La pregunta más fallada');
    await expect(primera.locator('.pct')).toContainText('100%');
    await expect(primera).toContainText('0 bien · 1 mal · 0 en blanco (de 1)');
    await expect(primera.locator('.trampa-mas')).toContainText('la trampa');
    await expect(primera.locator('.reparto > div')).toHaveCount(4);
    await expect(primera.locator('.reparto .ok')).toHaveCount(1);
    await expect(page.locator('.pfila').last().locator('.pct')).toContainText('0%');
    await sinDesborde(page);
  });
  test('exportar para Excel: CSV con BOM, una fila por alumno y las salidas de pestaña', async ({ page, servidor }) => {
    await abrir(page, servidor); await aResultados(page);
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#bExcelEx')]);
    expect(d.suggestedFilename()).toMatch(/^TDA2_ex1_\d{4}-\d\d-\d\d\.csv$/);
    const t = fs.readFileSync(await d.path(), 'utf8');
    expect(t.charCodeAt(0)).toBe(0xFEFF);
    const l = t.slice(1).split('\r\n');
    expect(l[0]).toBe('Nº;Nombre;Estado;Intento;Nota;Aciertos;Total;Tiempo;Salidas de pestaña;Segundos fuera;Recargas;Sin red');
    expect(l).toHaveLength(4);
    expect(l[1]).toBe('01;;Entregado;1;7,5;3;4;25:00;2;42;0;0');
    expect(l[2].startsWith('02;;En curso;1;')).toBe(true);
    expect(l[3]).toBe('03;;Sin empezar;;;;;;;;;');
  });
  test('los nombres cargados desde tu archivo salen también en los exámenes', async ({ page, servidor }) => {
    await abrir(page, servidor);
    await grupo(page, 'TDA II').locator('[data-res]').click();
    await page.setInputFiles('#iCSV', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('TDA2-01;Alumno Inventado Uno;AAA222\r\n', 'utf8') });
    await page.click('#bInicio');
    await aResultados(page);
    await expect(visible(page, '[data-id="TDA2-01"]')).toContainText('Alumno Inventado Uno');
  });
  test('actualizar vuelve a pedir los resultados al servidor', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aResultados(page);
    const antes = rpcs(S, 'profe_resultados').length;
    await page.click('#bRecargarEx');
    await expect.poll(() => rpcs(S, 'profe_resultados').length).toBe(antes + 1);
  });
  test('si la sesión caduca y no se puede renovar, pide entrar otra vez', async ({ page, servidor }) => {
    const S = await abrir(page, servidor); await aResultados(page);
    S.sesionCaducada(); S.refrescoFalla = true;
    await page.click('#bRecargarEx');
    await expect(page.locator('#msgLogin')).toContainText('Tu sesión ha caducado');
  });
  test('sin errores de JavaScript en una sesión completa de exámenes', async ({ page, servidor }) => {
    const errores = []; page.on('pageerror', e => errores.push(e.message)); page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
    await abrir(page, servidor); await aGestion(page);
    await page.click('#bInicio'); await aResultados(page);
    await visible(page, '[data-id="TDA2-01"]').click(); await page.keyboard.press('Escape');
    await page.click('.tabs button[data-t="preguntas"]'); await page.click('.tabs button[data-t="alumnos"]');
    expect(errores).toEqual([]);
  });
});
