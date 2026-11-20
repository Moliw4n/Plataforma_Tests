/* Ayudas comunes de las pruebas.
   REGLA: nunca se toca el Supabase real. Todas las peticiones a Supabase se interceptan y
   cualquier otra petición a internet se bloquea. Si una prueba llama a algo sin simular, falla. */
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SUPABASE = 'https://vltooganezktrqduwhzy.supabase.co';
const CODIGO_BUENO = 'ABC123';   // ABC-123 en pantalla
const CODIGO_ESPERA = 'ESP000';
const ALUMNO = { ok: true, alumno: 'TDA2-07', grupo: 'TDA2' };

const cargarTest = id => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', id + '.json'), 'utf8'));

const test = base.test.extend({
  /* servidor: simula Supabase y registra lo que recibe.
     servidor.guardados → cuerpos de guardar_intento · servidor.llamadas → nombres de funciones llamadas
     servidor.modoGuardar = 'ok' | 'error' → qué contesta guardar_intento
     servidor.examen = await crearServidorFalso() → atiende mis_juegos, empezar_partida, responder, evento, terminar_partida y mi_resultado */
  servidor: [async ({ page }, use) => {
    const s = { guardados: [], llamadas: [], inesperadas: [], modoGuardar: 'ok', examen: null };   // examen: servidor falso del examen (opcional)
    await page.route('**/*', ruta => {
      const url = new URL(ruta.request().url());
      if (url.hostname === 'localhost') return ruta.continue();
      if (url.origin !== SUPABASE) { s.inesperadas.push(url.href); return ruta.abort(); }
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      if (!m) { s.inesperadas.push(url.href); return ruta.fulfill({ status: 404, body: '{}' }); }
      const fn = m[1];
      const args = ruta.request().postDataJSON() || {};
      s.llamadas.push(fn);
      const json = (cuerpo, status = 200) => ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });
      if (fn === 'entrar') {
        if (args.p_codigo === CODIGO_BUENO) return json(ALUMNO);
        if (args.p_codigo === CODIGO_ESPERA) return json({ ok: false, motivo: 'espera' });
        return json({ ok: false, motivo: 'codigo' });
      }
      if (fn === 'guardar_intento') {
        s.guardados.push(args);
        return s.modoGuardar === 'error' ? json({ message: 'fallo simulado' }, 500) : json({ ok: true });
      }
      // Funciones del examen: las atiende el servidor falso (pruebas/servidor-examen-falso.js) si el test lo ha puesto en s.examen
      if (s.examen && ['mis_juegos', 'empezar_partida', 'responder', 'evento', 'terminar_partida', 'mi_resultado'].includes(fn)) {
        if (s.examen.red === false) return ruta.abort();                 // corte de internet simulado
        const resp = s.examen.llamar(fn, args);
        return s.examen.latencia ? setTimeout(() => json(resp), s.examen.latencia) : json(resp);
      }
      s.inesperadas.push(url.href);
      return json({}, 404);
    });
    await use(s);
    base.expect(s.inesperadas, 'peticiones sin simular').toEqual([]);
  }, { auto: true }]   // auto: se aplica a TODAS las pruebas, la pidan o no (nunca se toca el Supabase real)
});

/* Escribe el código y entra. */
async function entrar(page, codigo = 'ABC-123') {
  await page.fill('#iCodigo', codigo);
  await page.click('#bEntrar');
}

/* Contesta la pregunta que se ve. acierta=true elige la buena, false una mala. */
async function contestar(page, T, acierta = true, i = null) {
  const q = await page.evaluate(() => document.querySelector('.op.ok').dataset.oi);
  const buena = +q;
  const elegida = acierta ? buena : (buena === 0 ? 1 : 0);
  await page.click('.op[data-oi="' + elegida + '"]');
  return elegida;
}

/* Contesta todo el test; `fallos` = cuántas de las primeras se fallan. Termina en el resumen. */
async function hacerTest(page, T, fallos = 0, { forzar = false } = {}) {
  const n = T.preguntas.length;
  // forzar: pulsa por código (para no depender del diseño cuando se prueba otra cosa)
  const siguiente = () => forzar ? page.evaluate(() => document.querySelector('#bSig').click()) : page.click('#bSig');
  for (let i = 0; i < n; i++) {
    await contestar(page, T, i >= fallos);
    if (i < n - 1) await siguiente();
  }
  await siguiente(); // «Ver mi nota →»
}

module.exports = { test, expect: base.expect, entrar, contestar, hacerTest, cargarTest, CODIGO_BUENO, CODIGO_ESPERA };
