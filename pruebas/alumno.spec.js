/* Red de seguridad de la página del alumno (test.html).
   Describe lo que el alumno ve y hace HOY. La reorganización de la fase 0 no puede cambiar nada de esto. */
const { test, expect, entrar, contestar, hacerTest, cargarTest, CODIGO_BUENO, CODIGO_ESPERA } = require('./fixtures');

const ID = 'tda2-u1-python-practica';
const T = cargarTest(ID);
const URL = 'test.html?t=' + ID;

const sinDesbordeHorizontal = async page =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test.describe('acceso con código', () => {
  test('pide el código antes de nada y no llama al servidor hasta enviarlo', async ({ page, servidor }) => {
    await page.goto(URL);
    await expect(page.locator('.acceso h1')).toContainText('Práctica U1');
    await expect(page.locator('#iCodigo')).toBeVisible();
    await expect(page.locator('#bEmpezar')).toHaveCount(0);
    expect(servidor.llamadas).toEqual([]);
    await sinDesbordeHorizontal(page);
  });

  test('da formato ABC-123 mientras se escribe, ignora símbolos y pasa a mayúsculas', async ({ page, servidor }) => {
    await page.goto(URL);
    await page.fill('#iCodigo', 'a.b-c12 3'.slice(0, 7)); // el campo admite 7 caracteres en bruto
    await expect(page.locator('#iCodigo')).toHaveValue('ABC-12');
    await page.fill('#iCodigo', 'abc 123');
    await expect(page.locator('#iCodigo')).toHaveValue('ABC-123');
  });

  test('código demasiado corto: avisa sin llamar al servidor', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page, 'AB1');
    await expect(page.locator('#msgAcceso')).toContainText('6 caracteres');
    await expect(page.locator('#iCodigo')).toHaveClass(/mal/);
    expect(servidor.llamadas).toEqual([]);
  });

  test('código que no existe: mensaje claro y se puede reintentar', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page, 'ZZZ-999');
    await expect(page.locator('#msgAcceso')).toContainText('Ese código no existe');
    await expect(page.locator('#iCodigo')).toHaveClass(/mal/);
    await expect(page.locator('#bEntrar')).toBeEnabled();
    expect(servidor.llamadas).toEqual(['entrar']);
  });

  test('demasiados intentos: pide esperar un minuto', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page, CODIGO_ESPERA);
    await expect(page.locator('#msgAcceso')).toContainText('Espera un minuto');
  });

  test('sin conexión: lo dice y deja reintentar', async ({ page, servidor }) => {
    await page.route('**/rest/v1/rpc/entrar', r => r.abort());
    await page.goto(URL);
    await entrar(page);
    await expect(page.locator('#msgAcceso')).toContainText('No hay conexión');
    await expect(page.locator('#bEntrar')).toBeEnabled();
  });

  test('código bueno: portada con «nº 07» y envía el código sin guion', async ({ page, servidor }) => {
    let enviado;
    await page.route('**/rest/v1/rpc/entrar', r => { enviado = r.request().postDataJSON(); return r.fallback(); });
    await page.goto(URL);
    await entrar(page);
    await expect(page.locator('#bEmpezar')).toBeVisible();
    await expect(page.locator('.quien')).toContainText('nº 07');
    expect(enviado).toEqual({ p_codigo: CODIGO_BUENO });
    await sinDesbordeHorizontal(page);
  });

  test('«No soy yo» vuelve a pedir el código', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page);
    await page.click('#bSalir');
    await expect(page.locator('#iCodigo')).toBeVisible();
    await expect(page.locator('#msgAcceso')).toContainText('Has salido');
  });

  test('recargar la página obliga a escribir el código otra vez (no se guarda en el móvil)', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page);
    await page.reload();
    await expect(page.locator('#iCodigo')).toBeVisible();
  });
});

test.describe('hacer el test', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await entrar(page);
    await page.click('#bEmpezar');
  });

  test('portada → primera pregunta: contador, barra, opciones y pie', async ({ page }) => {
    await expect(page.locator('#contador')).toHaveText('1/' + T.preguntas.length);
    await expect(page.locator('#barra i')).toHaveCount(T.preguntas.length);
    await expect(page.locator('.op')).toHaveCount(4);
    await expect(page.locator('#bot')).toBeVisible();
    await expect(page.locator('#bSig')).toBeDisabled();
    await expect(page.locator('#bAnt')).toBeDisabled();
    await expect(page.locator('.enun')).toHaveText(T.preguntas[0].enun);
    await sinDesbordeHorizontal(page);
  });

  test('acertar: veredicto, explicación y trampa a la vista, opciones bloqueadas', async ({ page }) => {
    await contestar(page, T, true);
    await expect(page.locator('.veredicto')).toHaveClass(/bien/);
    await expect(page.locator('.veredicto')).toContainText('¡CORRECTO!');
    await expect(page.locator('.porque')).toContainText(T.preguntas[0].sol);
    await expect(page.locator('.trampa')).toContainText(T.preguntas[0].trampa);
    await expect(page.locator('.op:not([disabled])')).toHaveCount(0);
    await expect(page.locator('#bSig')).toBeEnabled();
    await expect(page.locator('#barra i').first()).toHaveClass(/ok/);
  });

  test('fallar: veredicto rojo y se marca la buena', async ({ page }) => {
    const elegida = await contestar(page, T, false);
    await expect(page.locator('.veredicto')).toHaveClass(/fallo/);
    await expect(page.locator('.veredicto')).toContainText('NO ES ESA');
    await expect(page.locator('.op[data-oi="' + elegida + '"]')).toHaveClass(/mal/);
    await expect(page.locator('.op.ok .marca-op')).toHaveText('✓');
    await expect(page.locator('#barra i').first()).toHaveClass(/mal/);
  });

  test('una respuesta dada no se puede cambiar', async ({ page }) => {
    const elegida = await contestar(page, T, false);
    await page.locator('.op.ok').click({ force: true });
    await expect(page.locator('.veredicto')).toHaveClass(/fallo/);
    await expect(page.locator('.op[data-oi="' + elegida + '"]')).toHaveClass(/mal/);
  });

  test('siguiente y anterior; al volver la pregunta sigue contestada', async ({ page }) => {
    await contestar(page, T, true);
    await page.click('#bSig');
    await expect(page.locator('#contador')).toHaveText('2/' + T.preguntas.length);
    await expect(page.locator('.enun')).toHaveText(T.preguntas[1].enun);
    await page.click('#bAnt');
    await expect(page.locator('#contador')).toHaveText('1/' + T.preguntas.length);
    await expect(page.locator('.q')).toHaveClass(/resuelta/);
    await expect(page.locator('.veredicto')).toContainText('¡CORRECTO!');
  });

  test('las opciones salen con las letras A-D', async ({ page }) => {
    await expect(page.locator('.op .l')).toHaveText(['A', 'B', 'C', 'D']);
  });

  test('la barra de progreso deja volver a una pregunta ya contestada, no a una pendiente', async ({ page }) => {
    test.skip(test.info().project.name === 'movil', 'en móvil la barra de progreso no se ve (por diseño)');
    await contestar(page, T, true);
    await page.click('#bSig');
    await page.locator('#barra i').nth(5).click();
    await expect(page.locator('#contador')).toHaveText('2/' + T.preguntas.length);
    await page.locator('#barra i').first().click();
    await expect(page.locator('#contador')).toHaveText('1/' + T.preguntas.length);
  });

  test('teclado: 1-4 responde y Intro avanza', async ({ page }) => {
    test.skip(test.info().project.name === 'movil', 'el teclado es de escritorio');
    await page.keyboard.press('1');
    await expect(page.locator('.q')).toHaveClass(/resuelta/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#contador')).toHaveText('2/' + T.preguntas.length);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#contador')).toHaveText('1/' + T.preguntas.length);
  });

  test('la pantalla de pregunta no se desborda en horizontal', async ({ page }) => {
    await contestar(page, T, false);
    await sinDesbordeHorizontal(page);
  });
});

test.describe('resultado y guardado', () => {
  test('todo bien: nota 10, se guarda con el formato de siempre', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page);
    await page.click('#bEmpezar');
    await hacerTest(page, T, 0);
    await expect(page.locator('.final .num')).toContainText('10');
    await expect(page.locator('.final .mensaje')).toContainText('¡Lo dominas!');
    await expect(page.locator('#guardado')).toContainText('Resultado guardado');
    await expect(page.locator('#bFalladas')).toHaveCount(0);
    await sinDesbordeHorizontal(page);

    expect(servidor.guardados).toHaveLength(1);
    const g = servidor.guardados[0];
    expect(Object.keys(g).sort()).toEqual(['p_codigo', 'p_datos']);
    expect(g.p_codigo).toBe(CODIGO_BUENO);
    const d = g.p_datos;
    // Este es el contrato con guardar_intento() (supabase/01_esquema.sql) y con Kronos: no se toca.
    expect(Object.keys(d).sort()).toEqual(['aciertos', 'empezado', 'nota', 'respuestas', 'segundos', 'terminado', 'test', 'total', 'version']);
    expect(d).toMatchObject({ test: ID, version: T.version, total: T.preguntas.length, aciertos: T.preguntas.length, nota: 10 });
    expect(new Date(d.empezado).toISOString()).toBe(d.empezado);
    expect(new Date(d.terminado).toISOString()).toBe(d.terminado);
    expect(Number.isInteger(d.segundos)).toBe(true);
    expect(d.respuestas).toHaveLength(T.preguntas.length);
    for (const r of d.respuestas) {
      expect(Object.keys(r).sort()).toEqual(['elegida', 'id', 'ms', 'ok']);
      expect(r.ok).toBe(true);
      expect(Number.isInteger(r.ms)).toBe(true);
    }
    expect(d.respuestas.map(r => r.id)).toEqual(T.preguntas.map(p => p.id));
    expect(d.respuestas.map(r => r.elegida)).toEqual(T.preguntas.map(p => p.ok));
  });

  test('con fallos: la nota sale de aciertos/total y se pueden repetir solo las falladas', async ({ page, servidor }) => {
    const fallos = 5, n = T.preguntas.length;
    await page.goto(URL);
    await entrar(page);
    await page.click('#bEmpezar');
    await hacerTest(page, T, fallos);
    const nota = Math.round((n - fallos) / n * 100) / 10;
    await expect(page.locator('.final .num')).toContainText(String(nota).replace('.', ','));
    await expect(page.locator('.rejilla button.mal')).toHaveCount(fallos);
    const d = servidor.guardados[0].p_datos;
    expect(d.aciertos).toBe(n - fallos);
    expect(d.nota).toBe(nota);
    expect(d.respuestas.filter(r => !r.ok)).toHaveLength(fallos);

    await page.click('#bFalladas');
    await expect(page.locator('#contador')).toHaveText('1/' + fallos);
    await expect(page.locator('#barra i')).toHaveCount(fallos);
  });

  test('pulsar un número del resumen abre esa pregunta para revisarla', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page);
    await page.click('#bEmpezar');
    await hacerTest(page, T, 1);
    await page.locator('.rejilla button').first().click();
    await expect(page.locator('.veredicto')).toContainText('NO ES ESA');
    await expect(page.locator('#bot')).toBeVisible();
  });

  test('«Repetir el test entero» empieza de cero y vuelve a guardar al terminar', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page);
    await page.click('#bEmpezar');
    await hacerTest(page, T, 0);
    await page.click('#bOtraVez');
    await expect(page.locator('#contador')).toHaveText('1/' + T.preguntas.length);
    await hacerTest(page, T, 0);
    await expect(page.locator('#guardado')).toContainText('Resultado guardado');
    expect(servidor.guardados).toHaveLength(2);
  });

  test('si el servidor falla al guardar: avisa y «Reintentar» lo vuelve a enviar', async ({ page, servidor }) => {
    servidor.modoGuardar = 'error';
    await page.goto(URL);
    await entrar(page);
    await page.click('#bEmpezar');
    await hacerTest(page, T, 0);
    await expect(page.locator('#guardado')).toContainText('No se ha podido guardar');
    servidor.modoGuardar = 'ok';
    await page.click('#bReintentar');
    await expect(page.locator('#guardado')).toContainText('Resultado guardado');
    expect(servidor.guardados).toHaveLength(2);
    expect(servidor.guardados[1]).toEqual(servidor.guardados[0]);
  });

  test('«Terminar y salir» cierra la sesión', async ({ page, servidor }) => {
    await page.goto(URL);
    await entrar(page);
    await page.click('#bEmpezar');
    await hacerTest(page, T, 0);
    await page.click('#bTerminar');
    await expect(page.locator('#iCodigo')).toBeVisible();
  });
});

test.describe('modo profesor (&modo=profe)', () => {
  test('sin código, con aviso, y nada se guarda', async ({ page, servidor }) => {
    await page.goto(URL + '&modo=profe');
    await expect(page.locator('#iCodigo')).toHaveCount(0);
    await expect(page.locator('.aviso-profe')).toContainText('NO SE GUARDA');
    await expect(page.locator('a.btn[href="panel.html"]')).toBeVisible();
    await page.click('#bEmpezar');
    await hacerTest(page, T, 0, { forzar: true });
    await expect(page.locator('#guardado')).toContainText('Modo profesor');
    expect(servidor.llamadas).toEqual([]);
    expect(servidor.guardados).toEqual([]);
  });
});

test.describe('modo profe en pantallas estrechas', () => {
  for (const ancho of [390, 360]) {
    test('la cabecera cabe en ' + ancho + ' px y el cartel se lee entero', async ({ page }) => {
      test.skip(test.info().project.name !== 'movil', 'solo tiene sentido en pantalla de móvil');
      await page.setViewportSize({ width: ancho, height: 844 });
      await page.goto(URL + '&modo=profe');
      await expect(page.locator('.aviso-profe')).toBeVisible();
      await sinDesbordeHorizontal(page);
      // el cartel no se corta con puntos suspensivos
      expect(await page.locator('.aviso-profe').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.click('#bEmpezar');
      await sinDesbordeHorizontal(page);
      // ya con el contador a la vista, el cartel sigue entero (antes se cortaba aquí)
      expect(await page.locator('.aviso-profe').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      // contador y botón CHULETA dentro de la pantalla
      for (const sel of ['#contador', '#bChuleta']) {
        const caja = await page.locator(sel).boundingBox();
        expect(caja.x + caja.width, sel).toBeLessThanOrEqual(ancho);
      }
    });
  }
});

test.describe('chuleta', () => {
  test('se abre con el botón y con la tecla C, tiene pestañas y se cierra con ✕ y Escape', async ({ page, servidor }) => {
    await page.goto(URL + '&modo=profe');
    await expect(page.locator('#bChuleta')).toBeVisible();
    await page.click('#bChuleta');
    await expect(page.locator('#capaChuleta')).toHaveClass(/on/);
    expect(await page.locator('#pestanas button').count()).toBeGreaterThan(1);
    await expect(page.locator('#cuerpoChuleta section.on')).toHaveCount(1);
    await page.click('#bCerrarChuleta');
    await expect(page.locator('#capaChuleta')).not.toHaveClass(/on/);
    if (test.info().project.name !== 'movil') {
      await page.keyboard.press('c');
      await expect(page.locator('#capaChuleta')).toHaveClass(/on/);
      await page.keyboard.press('Escape');
      await expect(page.locator('#capaChuleta')).not.toHaveClass(/on/);
    }
  });

  test('cambiar de pestaña cambia la sección visible', async ({ page, servidor }) => {
    await page.goto(URL + '&modo=profe');
    await page.click('#bChuleta');
    const segunda = page.locator('#pestanas button').nth(1);
    const tema = await segunda.getAttribute('data-tema');
    await segunda.click();
    await expect(page.locator('#cuerpoChuleta section.on')).toHaveAttribute('data-tema', tema);
  });

  test('«Repasar esto en la chuleta» abre el tema de la pregunta', async ({ page, servidor }) => {
    await page.goto(URL + '&modo=profe');
    await page.click('#bEmpezar');
    await contestar(page, T, false);
    await page.click('.ver-chuleta');
    await expect(page.locator('#capaChuleta')).toHaveClass(/on/);
    await expect(page.locator('#cuerpoChuleta section.on')).toHaveAttribute('data-tema', T.preguntas[0].tema);
  });

  test('el resaltado de Python pinta palabras clave en el código de la pregunta', async ({ page, servidor }) => {
    await page.goto(URL + '&modo=profe');
    await page.click('#bEmpezar');
    await expect(page.locator('pre.codigo .ln').first()).toBeVisible();
    await expect(page.locator('pre.codigo .f').first()).toHaveText('print');
  });
});

test.describe('enlaces que ya tienen los alumnos', () => {
  test('test.html sin parámetros abre el test por defecto', async ({ page, servidor }) => {
    await page.goto('test.html');
    await expect(page.locator('.acceso h1')).toContainText('Práctica U1');
  });

  test('el otro test (TDA1) también carga, con su materia y su chuleta', async ({ page, servidor }) => {
    const T1 = cargarTest('tda1-u1u2-repaso');
    await page.goto('test.html?t=tda1-u1u2-repaso&modo=profe');
    await expect(page.locator('#bEmpezar')).toBeVisible();
    await expect(page.locator('#bChuleta')).toBeVisible();
    await page.click('#bEmpezar');
    await expect(page.locator('#contador')).toHaveText('1/' + T1.preguntas.length);
    await expect(page).toHaveTitle(/Kairos/);
  });

  test('un test que no existe da un mensaje, no una página rota', async ({ page, servidor }) => {
    await page.goto('test.html?t=no-existe');
    await expect(page.locator('#escena')).toContainText('No encuentro este test');
  });
});
