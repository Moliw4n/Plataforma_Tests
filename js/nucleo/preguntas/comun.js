/* Núcleo · preguntas/comun.js — piezas de pantalla que comparten los tipos de pregunta nuevos. */
import { esc } from '../util.js';
import { conLineas } from '../codigo.js';

export const escAttr = s => esc(s).replace(/"/g, '&quot;');

// La etiqueta de color: la categoría si la hay; si no, el nombre del tipo de pregunta
export const categoriaDe = p => p.categoria || p.tipo;

/* Cabecera de la pregunta (etiqueta, actividad, enunciado, código opcional, pista opcional) */
export function izquierda(p, o) {
  let h = '<div class="izq"><div class="chips">' + o.chipTipo(categoriaDe(p)) + '<span class="act">' + esc(p.act || '') + '</span></div>';
  h += '<p class="enun">' + esc(p.enun) + '</p>';
  if (p.code) h += '<pre class="codigo">' + conLineas(p.code) + '</pre>';
  if (p.pista) h += '<p class="pista-resp">' + esc(p.pista) + '</p>';
  return h + '</div>';
}

/* Veredicto + explicación («por qué», «la trampa») + enlace a la chuleta. `extra` va antes del «por qué». */
export function pie(p, o, extra = '') {
  let h = '<div class="veredicto"></div><div class="solu">' + extra;
  if (p.sol) h += '<div class="caja porque"><b>POR QUÉ</b>' + esc(p.sol) + '</div>';
  if (p.trampa) h += '<div class="caja trampa"><b>LA TRAMPA</b>' + esc(p.trampa) + '</div>';
  if (o.hayChuleta && p.tema) h += '<button class="ver-chuleta" data-tema="' + esc(p.tema) + '">Repasar esto en la chuleta →</button>';
  return h + '</div>';
}

/* La pregunta entera: `interior` es lo que va arriba de la derecha (las opciones o el cuadro de escribir). */
export function marco(p, o, resuelta, interior, extraSolu = '') {
  return '<div class="q' + (resuelta ? ' resuelta' : '') + (p.code ? '' : ' sin-codigo') + '">' +
    izquierda(p, o) + '<div class="der">' + interior + pie(p, o, extraSolu) + '</div></div>';
}

export function pintarVeredicto(contenedor, bien) {
  const v = contenedor.querySelector('.veredicto');
  v.className = 'veredicto ' + (bien ? 'bien' : 'fallo');
  v.innerHTML = '<span class="ico">' + (bien ? '✓' : '✗') + '</span>' + (bien ? '¡CORRECTO!' : 'NO ES ESA');
}

export function enlazarChuleta(contenedor, o) {
  const vc = contenedor.querySelector('.ver-chuleta');
  if (vc) vc.onclick = () => o.alVerChuleta(vc.dataset.tema);
}

/* Opciones pulsables SIN corrección, para el modo examen (opción múltiple y verdadero/falso).
   opciones: [{ valor, letra, texto (ya escapado), mono? }]. El alumno puede cambiar de opción hasta entregar.
   opciones de `o`: { respuesta:{dada}|null, alResponder(valor), chipTipo } */
export function pintarOpcionesExamen(p, contenedor, o, opciones) {
  let elegida = o.respuesta ? o.respuesta.dada : undefined;
  const html = opciones.map(x =>
    '<button type="button" class="op' + (x.valor === elegida ? ' elegida' : '') + '" data-valor="' + escAttr(JSON.stringify(x.valor)) +
    '" aria-pressed="' + (x.valor === elegida) + '"><span class="l">' + x.letra + '</span><span class="tx' + (x.mono ? ' mono' : '') + '">' + x.texto + '</span></button>').join('');
  contenedor.innerHTML = '<div class="q en-examen' + (p.code ? '' : ' sin-codigo') + '">' + izquierda(p, o) +
    '<div class="der"><div class="ops">' + html + '</div></div></div>';
  contenedor.querySelectorAll('.op').forEach(b => b.onclick = () => {
    const v = JSON.parse(b.dataset.valor);
    elegida = v;
    contenedor.querySelectorAll('.op').forEach(x => { const on = x === b; x.classList.toggle('elegida', on); x.setAttribute('aria-pressed', String(on)); });
    o.alResponder(v);
  });
  return { respuesta: () => (elegida === undefined ? null : { dada: elegida }), bloquear() {}, mostrarCorreccion() {}, pendiente: () => null };
}

// Etiqueta de color a partir del nombre del tipo, cuando la pregunta no trae categoría propia
export const NOMBRES_TIPO = { opcion_multiple: 'Elige la correcta', verdadero_falso: '¿Verdadero o falso?', numerica: 'Haz la cuenta', respuesta_corta: 'Respuesta corta',
  imprime: '¿Qué imprime?', error: 'Encuentra el error', hueco: 'Completa el hueco' };
export const chipPorDefecto = t => '<span class="tipo t-' + t + '">' + esc(NOMBRES_TIPO[t] || t) + '</span>';
