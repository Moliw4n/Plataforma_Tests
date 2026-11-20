/* Kiron · página del alumno (el «runner»)
   Abre: jugar.html?t=<id-del-test>   (carga tests/<id>.json; test.html es un alias que reenvía aquí) · &modo=profe = sin código y sin guardar.
   Carga el contenido, pone la cabecera y la chuleta, pide el código y entrega el control al MODO
   que corresponda (por ahora siempre `practica`). El contrato de los modos está en nucleo/modos.js. */
import { rpc } from './nucleo/api.js';
import { esc, tituloBonito } from './nucleo/util.js';
import { crearChuleta } from './nucleo/chuleta.js';
import { mostrarAcceso } from './nucleo/acceso.js';
import { cargarModo } from './nucleo/modos.js';
import { aFormato2, validarBanco } from './nucleo/formato.js';
import { pintar as pintarOpcionMultiple } from './nucleo/preguntas/opcion_multiple.js';

(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const LOGO_KIRON = '<svg class="logo-kiron" role="img" aria-label="Kiron"><use href="img/logo-kiron.svg#logo"/></svg>';   // el logo se define en img/logo-kiron.svg; aquí solo se referencia
  const CFG = window.CONFIG || null;
  // Modo profesor (…&modo=profe): sin código y sin guardar nada.
  const MODO_PROFE = new URLSearchParams(location.search).get('modo') === 'profe';
  const E = $('#escena'), barra = $('#barra');

  let T = null;          // el contenido (test)
  let modo = null;       // el modo que lo juega
  let ctx = null;        // lo que se le entrega al modo

  async function cargar() {
    const id = new URLSearchParams(location.search).get('t') || window.TEST_POR_DEFECTO;
    try {
      if (window.TEST_EMBEBIDO) T = window.TEST_EMBEBIDO;
      else { const r = await fetch('tests/' + encodeURIComponent(id) + '.json', { cache: 'no-cache' }); if (!r.ok) throw 0; T = await r.json(); }
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
      nucleo: { pintar: { opcion_multiple: pintarOpcionMultiple } },
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
    await modo.terminar();
    acceso('Has salido. Escribe tu código para volver a entrar.');
  }

  cargar();
})();
