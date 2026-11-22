/* directo.html — la pantalla del PROFESOR y del PROYECTOR, a 1280 y a 390 px. Supabase simulado: el login y las tablas los atiende pruebas/servidor-panel-falso.js
   y las funciones profe_directo_* y las de los alumnos, pruebas/servidor-directo-falso.js (misma forma que el SQL real: pruebas/contrato-directo.test.js). */
const { test, expect } = require('./fixtures');
const { crearServidorPanel, datosExamen, EMAIL, CLAVE } = require('./servidor-panel-falso');
const { crearServidorDirecto } = require('./servidor-directo-falso');

const movil = () => test.info().project.name === 'movil';
const sinDesborde = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const jugador = (D, cod = 'AAA222') => D.llamar('directo_unirse', { p_codigo: cod, p_sala: D.sala });
const contesta = (D, cod, q, dada) => D.llamar('directo_responder', { p_codigo: cod, p_sesion: D.sesion, p_pregunta: q, p_dada: dada });

// Panel falso con bancos: u1 (con 8 preguntas jugables) y u2 (solo numéricas: no se pueden jugar en directo)
async function preparar(page, servidor, { directo = {}, ajustes = { sondeoProfeMs: 120 }, panel = {} } = {}) {
  const D = servidor.directo = await crearServidorDirecto({ creada: false, preguntas: ['t1mc', 't1vf', 't2mc'], ...directo });
  const datos = datosExamen();
  for (let k = 5; k <= 10; k++) datos.items.push({ banco: 'u1', id: 'q' + k, tipo: k % 2 ? 'opcion_multiple' : 'verdadero_falso', datos: { tipo: k % 2 ? 'opcion_multiple' : 'verdadero_falso', enun: 'P' + k } });
  datos.items.push({ banco: 'u2', id: 'n1', tipo: 'numerica', datos: { tipo: 'numerica', enun: 'N', valor: 1 } });
  datos.bancos.push({ id: 'u2', titulo: 'Banco U2 · Cuentas', materia: 'TDA II', unidad: 'U2', version: 1 });
  const P = servidor.panel = await crearServidorPanel({ ...datos, ...panel });
  P.directo = D;
  await page.addInitScript(a => { window.KIRON_AJUSTES = a; }, ajustes);
  return D;
}
async function entrar(page) { await page.goto('directo.html'); await page.fill('#iEmail', EMAIL); await page.fill('#iPass', CLAVE); await page.click('#bLogin'); }
// Entra, crea la sala (banco u1, 3 preguntas) y espera a ver el código
async function conSala(page, servidor, opciones) {
  const D = await preparar(page, servidor, opciones);
  await entrar(page);
  await page.check('[name=banco][value=u1]'); await page.fill('#sPreg', '3'); await page.click('#bAbrirSala');
  await expect(page.locator('#codigoSala')).toBeVisible();
  return D;
}
const empezar = async page => { await page.click('#bAvanzar'); await expect(page.locator('.proyector-q .op-d').first()).toBeVisible(); };

test.describe('entrar y crear la sala', () => {
  test('sin sesión pide el correo; con una clave mala avisa; con la buena enseña «Nueva sala»', async ({ page, servidor }) => {
    await preparar(page, servidor);
    await page.goto('directo.html');
    await expect(page.locator('#iEmail')).toBeVisible();
    await page.fill('#iEmail', EMAIL); await page.fill('#iPass', 'mala'); await page.click('#bLogin');
    await expect(page.locator('#msgLogin')).toContainText('incorrectos');
    await page.fill('#iPass', CLAVE); await page.click('#bLogin');
    await expect(page.locator('#fSala')).toBeVisible();
    await expect(page.locator('#usuario')).toContainText(EMAIL);
    await sinDesborde(page);
  });
  test('si ya has entrado en el panel, aquí ya estás dentro (misma sesión del navegador)', async ({ page, servidor }) => {
    const D = await preparar(page, servidor);
    await page.addInitScript(([t, r]) => { localStorage.setItem('pt_sesion_profe', JSON.stringify({ token: t, refresh: r, email: 'profe@ejemplo.test', exp: Date.now() + 3600000 })); }, [servidor.panel.token, servidor.panel.refresh]);
    await page.goto('directo.html');
    await expect(page.locator('#fSala')).toBeVisible();
    expect(D).toBeTruthy();
  });
  test('el formulario ofrece los grupos y solo los bancos con preguntas jugables (con cuántas tienen)', async ({ page, servidor }) => {
    await preparar(page, servidor); await entrar(page);
    await expect(page.locator('#sGrupo option')).toHaveCount(2);
    await expect(page.locator('[name=banco]')).toHaveCount(1);
    await expect(page.locator('.bancos-sala')).toContainText('Banco U1 · Python');
    await expect(page.locator('.bancos-sala')).toContainText('8 preguntas jugables');
    await expect(page.locator('.bancos-sala')).not.toContainText('U2');
    await expect(page.locator('#sPreg')).toHaveValue('10'); await expect(page.locator('#sSeg')).toHaveValue('20'); await expect(page.locator('#sTema')).toBeChecked();
  });
  test('el formulario no deja mandar cosas mal puestas y no llama al servidor', async ({ page, servidor }) => {
    const D = await preparar(page, servidor); await entrar(page);
    const msg = page.locator('#msgSala');
    await page.click('#bAbrirSala'); await expect(msg).toContainText('Elige al menos un banco');
    await page.check('[name=banco]');
    await page.fill('#sPreg', '9'); await page.click('#bAbrirSala'); await expect(msg).toContainText('solo tienen 8 preguntas jugables');
    await page.fill('#sPreg', '0'); await page.click('#bAbrirSala'); await expect(msg).toContainText('de 1 a 50');
    await page.fill('#sPreg', '3'); await page.fill('#sSeg', '2'); await page.click('#bAbrirSala'); await expect(msg).toContainText('de 5 a 120');
    expect(D.llamadas.filter(l => l.fn === 'profe_directo_crear')).toHaveLength(0);
  });
  test('crear la sala manda lo elegido y enseña el código grande y el enlace para los alumnos', async ({ page, servidor }) => {
    const D = await preparar(page, servidor); await entrar(page);
    await page.selectOption('#sGrupo', 'TDA2'); await page.check('[name=banco]'); await page.fill('#sPreg', '3'); await page.fill('#sSeg', '30'); await page.fill('#sTit', 'Repaso U1'); await page.uncheck('#sTema');
    await page.click('#bAbrirSala');
    await expect(page.locator('#codigoSala')).toHaveText('123 456');
    expect(D.creadaCon).toEqual({ grupo: 'TDA2', bancos: ['u1'], preguntas: 3, tiempo_s: 30, equilibrar: 'ninguno', titulo: 'Repaso U1' });
    await expect(page.locator('#enlaceSala')).toHaveText(/\/jugar\.html\?d=123456$/);
    await expect(page.locator('.sala-cab')).toContainText('Repaso U1');
    await expect(page.locator('#bAvanzar')).toHaveText('Empezar ▶');
    await sinDesborde(page);
  });
  test('si el servidor rechaza la sala, el mensaje es legible y se puede corregir', async ({ page, servidor }) => {
    const D = await preparar(page, servidor); await entrar(page);
    D.errorCrear = 'directo_no_valido: el grupo no existe';
    await page.check('[name=banco]'); await page.fill('#sPreg', '3'); await page.click('#bAbrirSala');
    await expect(page.locator('#msgSala')).toHaveText('El grupo no existe.');
    await expect(page.locator('#bAbrirSala')).toBeEnabled();
  });
  test('si el SQL 09 aún no está instalado, lo dice claro', async ({ page, servidor }) => {
    await preparar(page, servidor); servidor.panel.sinDirecto = true; await entrar(page);
    await expect(page.locator('.aviso-examen.rojo')).toContainText('Falta instalar el SQL 09_directo.sql');
  });
});

test.describe('la sala en marcha', () => {
  test('en la espera salen los apodos de quien entra (atenuados si no están conectados), sin números de alumno hasta que se pida', async ({ page, servidor }) => {
    const D = await conSala(page, servidor);
    await expect(page.locator('#chips')).toContainText('Aún no ha entrado nadie');
    jugador(D, 'AAA222'); jugador(D, 'BBB333');
    await expect(page.locator('.chip-jug')).toHaveCount(2);
    await expect(page.locator('.sala-cab')).toContainText('2 jugadores');
    expect(await page.locator('#app').innerText()).not.toMatch(/TDA2-0/);
    D.participantes[1].visto = 0;                                                // el 2.º deja de dar señales
    await expect(page.locator('.chip-jug.fuera')).toHaveCount(1);
    await page.click('#bIds');
    await expect(page.locator('.chip-jug small').first()).toContainText('TDA2-0');
    await page.click('#bIds');
    expect(await page.locator('#app').innerText()).not.toMatch(/TDA2-0/);
  });
  test('«Empezar» abre la primera pregunta: enunciado, 4 opciones con su letra, cuenta atrás y barra; la correcta NO se ve', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    await empezar(page);
    await expect(page.locator('.enun-directo')).toHaveText('Enunciado t1mc');
    await expect(page.locator('.op-d')).toHaveCount(4);
    await expect(page.locator('.op-d .l')).toHaveText(['A', 'B', 'C', 'D']);
    await expect(page.locator('#tiempoGrande')).toHaveText(/^(20|19)$/);
    await expect(page.locator('.meta-q')).toContainText('PREGUNTA 1 DE 3');
    await expect(page.locator('#contestadas')).toHaveText('0 de 1 han contestado');
    await expect(page.locator('.op-d.correcta')).toHaveCount(0);
    for (const prohibido of ['SOLUCION-', 'TRAMPA-', 'POR QUÉ']) expect(await page.content()).not.toContain(prohibido);
    await expect(page.locator('#bAvanzar')).toHaveText('Cerrar la pregunta ■');
    await sinDesborde(page);
    if (movil()) await expect(page.locator('.opciones-directo')).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px$/);   // una sola columna en el móvil
  });
  test('la cuenta atrás baja sola y el contador de «han contestado» se actualiza', async ({ page, servidor }) => {
    const D = await conSala(page, servidor, { directo: { tiempoS: 60 } }); jugador(D); jugador(D, 'BBB333');
    await empezar(page);
    const t1 = Number(await page.locator('#tiempoGrande').textContent());
    await page.waitForTimeout(1300);
    expect(Number(await page.locator('#tiempoGrande').textContent())).toBeLessThan(t1);
    contesta(D, 'AAA222', 0, 1);
    await expect(page.locator('#contestadas')).toHaveText('1 de 2 han contestado');
  });
  test('verdadero/falso: dos opciones grandes «Verdadero» y «Falso»', async ({ page, servidor }) => {
    const D = await conSala(page, servidor, { directo: { preguntas: ['t1vf'] } }); jugador(D);
    await empezar(page);
    await expect(page.locator('.op-d')).toHaveCount(2);
    await expect(page.locator('.op-d .tx')).toHaveText(['Verdadero', 'Falso']);
    await expect(page.locator('.op-d .l')).toHaveText(['V', 'F']);
  });
  test('«Cerrar la pregunta» enseña el resultado: la correcta marcada, cuántos eligieron cada opción, el porqué, la trampa y el top 5', async ({ page, servidor }) => {
    const D = await conSala(page, servidor);
    for (const c of ['AAA222', 'BBB333']) jugador(D, c);
    await empezar(page);
    contesta(D, 'AAA222', 0, 1); contesta(D, 'BBB333', 0, 0);
    await page.click('#bAvanzar');
    await expect(page.locator('.meta-q')).toContainText('RESULTADO · PREGUNTA 1 DE 3');
    await expect(page.locator('.op-d.correcta')).toHaveCount(1);
    await expect(page.locator('.op-d.correcta .tx')).toHaveText('B t1');
    await expect(page.locator('.op-d.dim')).toHaveCount(3);
    await expect(page.locator('.op-d .veces b')).toHaveText(['1', '1', '0', '0']);          // A: 1, B: 1
    await expect(page.locator('.caja.porque')).toContainText('SOLUCION-t1mc');
    await expect(page.locator('.caja.trampa')).toContainText('TRAMPA-t1mc');
    await expect(page.locator('.marcador.grande li')).toHaveCount(2);
    await expect(page.locator('.marcador.grande li').first()).toContainText('Zorro Azul');
    await expect(page.locator('#bAvanzar')).toHaveText('Siguiente pregunta ▶');
    await sinDesborde(page);
  });
  test('el marcador del resultado enseña solo los 5 primeros', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D); D.sembrar([900, 800, 700, 600, 500, 400, 300]);
    await empezar(page); await page.click('#bAvanzar');
    await expect(page.locator('.marcador.grande li')).toHaveCount(5);
    await expect(page.locator('.marcador.grande li').first()).toContainText('900');
  });
  test('recorrido completo: 3 preguntas → «Ver el final» → podio con los 3 primeros, y se puede abrir otra sala', async ({ page, servidor }) => {
    const D = await conSala(page, servidor);
    for (const c of ['AAA222', 'BBB333']) jugador(D, c);
    D.sembrar([5000]);                                     // un jugador de relleno que va primero
    await empezar(page);                                   // espera → pregunta 1
    for (let q = 0; q < 3; q++) {
      await expect(page.locator('.meta-q')).toContainText('PREGUNTA ' + (q + 1) + ' DE 3');
      contesta(D, 'AAA222', q, D.banco.preguntas.find(p => p.id === D.preguntas[q].id).ok);          // la respuesta buena de cada una
      await page.click('#bAvanzar');                       // cerrar la pregunta
      await expect(page.locator('.meta-q')).toContainText('RESULTADO');
      await expect(page.locator('#bAvanzar')).toHaveText(q === 2 ? 'Ver el final ▶' : 'Siguiente pregunta ▶');
      await page.click('#bAvanzar');                       // siguiente pregunta, o el final
    }
    await expect(page.locator('.final-directo h1')).toHaveText('El podio');
    await expect(page.locator('.puesto')).toHaveCount(3);
    await expect(page.locator('.puesto-1')).toContainText('5.000 pts');
    await expect(page.locator('.puesto-2')).toContainText('Zorro Azul');          // acertó las 3: segundo, con sus puntos
    await expect(page.locator('.puesto-2')).toContainText('3 de 3 bien');
    expect(await page.locator('.puesto').first().innerText()).toContain('🥇');
    await expect(page.locator('#bNueva')).toBeVisible();
    await sinDesborde(page);
    await page.click('#bNueva');
    await expect(page.locator('#fSala')).toBeVisible();
  });
  test('«Ver quién es quién» muestra los números de alumno también en el podio', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    D.estado = 'terminada';
    await expect(page.locator('.final-directo')).toBeVisible();
    expect(await page.locator('#app').innerText()).not.toMatch(/TDA2-0/);
    await page.click('#bIds');
    await expect(page.locator('.puesto small').first()).toContainText('TDA2-01');
  });
  test('cuando se acaba el tiempo, la sala pasa sola al resultado', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    D.tiempoS = 1;                                         // (crear la sala fija el tiempo del formulario: se acorta después)
    await empezar(page);
    await expect(page.locator('.meta-q')).toContainText('RESULTADO', { timeout: 7000 });
  });
  test('el teclado sirve para pasar de pantalla (Espacio, Intro o →), como con un mando de presentaciones', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    await page.keyboard.press('Space'); await expect(page.locator('.proyector-q .op-d').first()).toBeVisible();
    await page.keyboard.press('ArrowRight'); await expect(page.locator('.meta-q')).toContainText('RESULTADO');
    await page.keyboard.press('Enter'); await expect(page.locator('.meta-q')).toContainText('PREGUNTA 2 DE 3');
    expect(D.actual).toBe(1);
  });
  test('una doble pulsación no se salta una pantalla', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    await page.dblclick('#bAvanzar');
    await expect(page.locator('.proyector-q .op-d').first()).toBeVisible();
    await page.waitForTimeout(400);
    expect(D.estado).toBe('pregunta'); expect(D.actual).toBe(0);
  });
  test('si la sala cambió sola mientras el profesor pulsaba, no se salta el resultado', async ({ page, servidor }) => {
    const D = await conSala(page, servidor, { ajustes: { sondeoProfeMs: 5000 } }); jugador(D);
    await empezar(page);                                   // la pantalla cree que está en «pregunta»…
    D.avanzar();                                           // …pero el profesor la cerró desde otro sitio (o se acabó el tiempo)
    await page.click('#bAvanzar');
    await expect(page.locator('.meta-q')).toContainText('RESULTADO', { timeout: 6000 });
    expect(D.estado).toBe('resultado'); expect(D.actual).toBe(0);
  });
});

test.describe('salas abiertas y cerrar', () => {
  test('recargar la página en medio de una sala vuelve a ella (sin pedir otra vez la contraseña)', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    await empezar(page);
    await page.reload();
    await expect(page.locator('.proyector-q .op-d').first()).toBeVisible();
    await expect(page.locator('.sala-cab')).toContainText('123 456');
    expect(D.actual).toBe(0);
  });
  test('«Cerrar sala» pide confirmación; si se cancela no se cierra, y si se acepta los alumnos ven el final', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    await page.click('#bCerrarSala'); await expect(page.locator('#dialogo')).toBeVisible();
    await page.click('#dlgNo'); await expect(page.locator('#dialogo')).toBeHidden();
    expect(D.estado).toBe('espera');
    await page.click('#bCerrarSala'); await page.click('#dlgSi');
    await expect(page.locator('.final-directo')).toBeVisible();
    expect(D.estado).toBe('terminada');
  });
  test('en el inicio salen las salas abiertas, con «Abrir» y «Cerrar»', async ({ page, servidor }) => {
    const D = await preparar(page, servidor, { directo: { creada: true } }); jugador(D);
    await entrar(page);
    await expect(page.locator('.sala-abierta')).toContainText('Directo de prueba');
    await expect(page.locator('.sala-abierta')).toContainText('123 456');
    await expect(page.locator('.sala-abierta')).toContainText('1 jugadores');
    await page.click('[data-abrir]');
    await expect(page.locator('#codigoSala')).toHaveText('123 456');
    await page.click('#bSalir');                                                // salir olvida la sala abierta
    await expect(page.locator('#iEmail')).toBeVisible();
  });
  test('«Cerrar» una sala desde el inicio pide confirmación y la quita de la lista', async ({ page, servidor }) => {
    const D = await preparar(page, servidor, { directo: { creada: true } });
    await entrar(page);
    await page.click('[data-cerrar]'); await expect(page.locator('#dialogo')).toBeVisible(); await page.click('#dlgSi');
    await expect(page.locator('.sala-abierta')).toHaveCount(0);
    expect(D.estado).toBe('terminada');
  });
});

test.describe('si algo falla', () => {
  test('se corta internet: aviso en rojo, la pantalla no se desmonta y, al volver, sigue sola', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    servidor.panel.red = false;
    await expect(page.locator('#avisoRedDirecto')).toBeVisible();
    await expect(page.locator('#codigoSala')).toBeVisible();
    servidor.panel.red = true;
    await expect(page.locator('#avisoRedDirecto')).toHaveCount(0);
    D.avanzar();
    await expect(page.locator('.proyector-q .op-d').first()).toBeVisible();
  });
  test('si la sesión caduca y no se puede renovar, pide entrar otra vez', async ({ page, servidor }) => {
    await conSala(page, servidor);
    servidor.panel.refrescoFalla = true; servidor.panel.sesionCaducada();
    await expect(page.locator('#iEmail')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('#msgLogin')).toContainText('caducado');
  });
  test('si la sesión caduca pero se puede renovar, sigue sin molestar', async ({ page, servidor }) => {
    const D = await conSala(page, servidor); jugador(D);
    servidor.panel.sesionCaducada();
    D.avanzar();
    await expect(page.locator('.proyector-q .op-d').first()).toBeVisible();
  });
  test('si la sala desaparece mientras se proyecta, vuelve al inicio con un aviso', async ({ page, servidor }) => {
    const D = await conSala(page, servidor);
    D.creada = false;
    await expect(page.locator('#fSala')).toBeVisible();
    await expect(page.locator('.aviso-examen').first()).toContainText('ya no existe');
  });
  test('al recargar con una sala guardada que ya no existe, vuelve al inicio con un aviso', async ({ page, servidor }) => {
    await preparar(page, servidor); await entrar(page);
    await expect(page.locator('#fSala')).toBeVisible();
    await page.evaluate(() => localStorage.setItem('pt_directo_sesion', '99999999-9999-4999-8999-999999999999'));
    await page.reload();
    await expect(page.locator('#fSala')).toBeVisible();
    await expect(page.locator('.aviso-examen').first()).toContainText('ya no existe');
  });
});

test('sin ningún error de JavaScript en toda una partida', async ({ page, servidor }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  const D = await conSala(page, servidor); jugador(D);
  await empezar(page);
  for (let q = 0; q < 3; q++) { await page.click('#bAvanzar'); await expect(page.locator('.meta-q')).toContainText('RESULTADO'); await page.click('#bAvanzar'); }
  await expect(page.locator('.final-directo')).toBeVisible();
  expect(errores).toEqual([]);
});
