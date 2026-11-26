/* Kiron · página del alumno (el «runner»)
   Dos formas de abrirla:
     jugar.html?t=<id-del-test>   práctica: carga tests/<carpeta>/<id>.json (la carpeta, de tests/index.json) (test.html es un alias que reenvía aquí) · &modo=profe = sin código y sin guardar.
     jugar.html?j=<id-del-juego>  examen: pide el código y busca ese juego entre los asignados a su grupo (mis_juegos);
                                  el contenido NO está aquí: lo manda el servidor, sin soluciones. &modo=profe no vale: siempre hace falta código.
     jugar.html?d=<sala>          directo (tipo Kahoot): pide el código y entra en la sala de 6 cifras que el profesor ha abierto.
     jugar.html?d                 el mismo directo con ENLACE FIJO (sin código de sala): tras el código de alumno pide el de la sala, que es el que proyecta el profesor.
   Pide el código y entrega el control al MODO que corresponda. El contrato de los modos está en nucleo/modos.js. */
import { rpc } from './nucleo/api.js';
import { esc, tituloBonito, rutaTest } from './nucleo/util.js';
import { crearChuleta } from './nucleo/chuleta.js';
import { mostrarAcceso } from './nucleo/acceso.js';
import { cargarModo } from './nucleo/modos.js';
import { aFormato2, validarBanco } from './nucleo/formato.js';
import { RENDERIZADORES } from './nucleo/preguntas/index.js';

(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const LOGO_KIRON = '<svg class="logo-kiron" role="img" aria-label="Kiron"><use href="img/logo-kiron.svg#logo"/></svg>';   // el logo se define en img/logo-kiron.svg; aquí solo se referencia
  const CFG = window.CONFIG || null;
  // Modo profesor (…&modo=profe): sin código y sin guardar nada.
  const PARAMS = new URLSearchParams(location.search);
  const JUEGO_ID = PARAMS.get('j');
  const SALA = JUEGO_ID ? null : PARAMS.get('d');
  const MODO_PROFE = !JUEGO_ID && SALA === null && PARAMS.get('modo') === 'profe';
  const E = $('#escena'), barra = $('#barra');

  let T = null;          // el contenido (test)
  let modo = null;       // el modo que lo juega
  let ctx = null;        // lo que se le entrega al modo

  async function cargar() {
    if (JUEGO_ID) return cargarJuego();
    if (SALA !== null) return cargarDirecto();
    const id = PARAMS.get('t') || window.TEST_POR_DEFECTO;
    try {
      if (window.TEST_EMBEBIDO) T = window.TEST_EMBEBIDO;
      else { const r = await fetch(await rutaTest(id), { cache: 'no-cache' }); if (!r.ok) throw 0; T = await r.json(); }
      T = aFormato2(T);   // formato 1 o 2: de aquí en adelante, siempre formato 2
    } catch (e) {
      E.innerHTML = '<div class="cargando">No encuentro este test. Revisa el enlace que te ha pasado tu profesor.</div>';
      return;
    }
    const problemas = validarBanco(T);
    if (problemas.length) console.warn('Kiron: el test «' + T.id + '» tiene problemas:\n- ' + problemas.join('\n- '));
    try { modo = await cargarModo(T.modo || 'practica'); }
    catch (e) {
      console.error(e);
      E.innerHTML = '<div class="cargando">Este test necesita algo que todavía no está disponible. Avisa a tu profesor.</div>';
      return;
    }
    document.title = T.titulo + ' · Kiron';
    $('#marca').innerHTML = LOGO_KIRON + ' <span>· ' + esc(T.materia || '') + ' · ' + esc(T.titulo) + '</span>';
    ctx = {
      alumno: null, juego: null, contenido: T,
      api: { rpc },
      nucleo: { preguntas: RENDERIZADORES },
      contenedor: E, chuleta: null, modoProfe: MODO_PROFE,
      temaActual: () => null,          // lo sustituye el modo
      salir
    };
    if (T.chuleta) ctx.chuleta = crearChuleta({ url: T.chuleta, materia: T.materia || '', temaActual: () => ctx.temaActual() });
    if (MODO_PROFE) {
      document.body.classList.add('modo-profe');
      $('#marca').innerHTML = '<span class="aviso-profe">PROFE · NO SE GUARDA</span>';
    }
    if (CFG && !MODO_PROFE) acceso(); else modo.iniciar(ctx);
  }

  function acceso(mensaje) {
    $('#bot').hidden = true; barra.innerHTML = ''; $('#contador').textContent = '';
    mostrarAcceso({
      contenedor: E, mensaje,
      sup: (T.materia || '') + (T.unidad ? ' · ' + T.unidad : ''),
      titulo: tituloBonito(T.titulo),
      alEntrar: s => { ctx.alumno = s; modo.iniciar(ctx); }
    });
  }
  async function salir() {
    ctx.alumno = null;
    if (modo) await modo.terminar();
    if (JUEGO_ID) accesoJuego('Has salido. Escribe tu código para volver a entrar.'); else if (SALA !== null) accesoDirecto('Has salido. Escribe tu código para volver a entrar.'); else acceso('Has salido. Escribe tu código para volver a entrar.');
  }

  /* ---------- examen: jugar.html?j=<juego> ---------- */
  function cargarJuego() {
    document.title = 'Examen · Kiron';
    $('#marca').innerHTML = LOGO_KIRON + ' <span>· Examen</span>';
    ctx = { alumno: null, juego: null, contenido: null, api: { rpc }, nucleo: { preguntas: RENDERIZADORES },
            contenedor: E, chuleta: null, modoProfe: false, temaActual: () => null, salir };
    if (!CFG) { E.innerHTML = '<div class="cargando">No hay conexión con el servidor. Avisa a tu profesor.</div>'; return; }
    accesoJuego();
  }
  function accesoJuego(mensaje) {
    $('#bot').hidden = true; $('#reloj').hidden = true; barra.innerHTML = ''; $('#contador').textContent = '';
    mostrarAcceso({ contenedor: E, mensaje, sup: 'Examen', titulo: 'Tu examen', alEntrar: s => { ctx.alumno = s; abrirJuego(); } });
  }
  function mensajeJuego(texto, { reintentar = false } = {}) {
    E.innerHTML = '<div class="portada"><div class="sup">EXAMEN</div><p class="enun">' + esc(texto) + '</p><div class="acciones">' +
      (reintentar ? '<button class="btn pri" id="bReintentarJuego">Reintentar</button>' : '') + '<button class="btn" id="bSalirJuego">No soy yo</button></div></div>';
    if (reintentar) $('#bReintentarJuego').onclick = abrirJuego;
    $('#bSalirJuego').onclick = salir;
  }
  async function abrirJuego() {
    E.innerHTML = '<div class="cargando">Buscando tu examen…</div>';
    let r;
    try { r = await rpc('mis_juegos', { p_codigo: ctx.alumno.codigo }, { reintentos: 1 }); }
    catch (e) { return mensajeJuego('No hay conexión con el servidor. Comprueba internet y vuelve a probar.', { reintentar: true }); }
    if (!r.ok) return mensajeJuego(r.motivo === 'espera' ? 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.' : 'No he podido comprobar tu código. Vuelve a entrar.');
    const juego = (r.juegos || []).find(j => j.juego === JUEGO_ID);
    if (!juego) return mensajeJuego('No tienes asignado este examen. Revisa el enlace que te ha pasado tu profesor.');
    try { modo = await cargarModo(juego.modo); }
    catch (e) { console.error(e); return mensajeJuego('Este examen necesita algo que todavía no está disponible. Avisa a tu profesor.'); }
    document.title = juego.titulo + ' · Kiron';
    $('#marca').innerHTML = LOGO_KIRON + ' <span>· ' + esc(juego.titulo) + '</span>';
    ctx.juego = juego;
    modo.iniciar(ctx);
  }

  /* ---------- directo: jugar.html?d=<sala> ---------- */
  function cargarDirecto() {
    document.title = 'Directo · Kiron';
    $('#marca').innerHTML = LOGO_KIRON + ' <span>· Directo</span>';
    ctx = { alumno: null, juego: null, sala: SALA || null, contenido: null, api: { rpc }, nucleo: { preguntas: RENDERIZADORES },
            contenedor: E, chuleta: null, modoProfe: false, temaActual: () => null, salir };
    if (!CFG) { E.innerHTML = '<div class="cargando">No hay conexión con el servidor. Avisa a tu profesor.</div>'; return; }
    if (SALA !== '' && !/^[0-9]{6}$/.test(SALA)) { E.innerHTML = '<div class="cargando">El enlace de la sala no está bien. Pídele a tu profesor que te lo vuelva a pasar.</div>'; return; }
    accesoDirecto();
  }
  function accesoDirecto(mensaje) {
    $('#bot').hidden = true; $('#reloj').hidden = true; barra.innerHTML = ''; $('#contador').textContent = '';
    mostrarAcceso({ contenedor: E, mensaje, sup: 'Directo', titulo: 'Entra en la sala', alEntrar: s => { ctx.alumno = s; abrirDirecto(); } });
  }
  async function abrirDirecto() {
    try { modo = await cargarModo('directo'); }
    catch (e) { console.error(e); E.innerHTML = '<div class="cargando">Este juego necesita algo que todavía no está disponible. Avisa a tu profesor.</div>'; return; }
    modo.iniciar(ctx);
  }

  cargar();
})();
