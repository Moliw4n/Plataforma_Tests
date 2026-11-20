/* Núcleo · preguntas/opcion_multiple.js — renderizador del tipo «opción múltiple».
   Interfaz común de todos los tipos de pregunta:
     pintar(item, contenedor, opciones) → { respuesta(), bloquear(), mostrarCorreccion(c) }
   opciones: { orden, respuesta, chipTipo, hayChuleta, alResponder(oi), alVerChuleta(tema) }
     orden      índices de las opciones en el orden en que se enseñan
     respuesta  {elegida, ok} si ya estaba contestada (al volver a la pregunta), o null
     chipTipo   función categoría → HTML de la etiqueta de color (la categoría es p.categoria; p.tipo es el tipo de pregunta)
   mostrarCorreccion(c): c = {elegida, ok}. Marca la opción elegida, el veredicto y la explicación. */
import { esc } from '../util.js';
import { pinta, conLineas, consola } from '../codigo.js';
import { categoriaDe } from './comun.js';

const LET = 'ABCD';

// Corrección en el navegador (solo para práctica: la solución viaja con la pregunta). dada = índice de la opción elegida.
export const corregir = (p, dada) => ({ ok: dada === p.ok, correcta: p.ok });

export function pintar(p, contenedor, o) {
  let resp = o.respuesta || null;
  const r = resp;
  let h = '<div class="q' + (r ? ' resuelta' : '') + (p.code ? '' : ' sin-codigo') + '">';
  h += '<div class="izq"><div class="chips">' + o.chipTipo(categoriaDe(p)) + '<span class="act">' + esc(p.act || '') + '</span></div>';
  h += '<p class="enun">' + esc(p.enun) + '</p>';
  if (p.code) h += '<pre class="codigo">' + conLineas(p.code) + '</pre>';
  const htmlConsola = !p.salida ? '' : '<div class="consola"><span class="et">LO QUE SALE DE VERDAD' +
       (p.categoria === 'hueco' ? ' (CON LA BUENA)' : '') +
       (p.stdin ? ' · EL USUARIO ESCRIBE ' + esc(p.stdin.trim().split('\n').join(', ')) : '') +
       '</span><pre>' + consola(p.salida) + '</pre></div>';
  if (htmlConsola) h += '<div class="solu solo-escritorio">' + htmlConsola + '</div>';
  h += '</div><div class="der">';
  const mono = p.categoria === 'imprime' || p.categoria === 'hueco';
  h += '<div class="ops">' + o.orden.map((oi, j) => {
    const cls = ['op'];
    if (oi === p.ok) cls.push('ok');
    if (r && r.elegida === oi) cls.push('elegida', oi === p.ok ? 'bien' : 'mal');
    const marca = r ? (oi === p.ok ? '✓' : (r.elegida === oi ? '✗' : '')) : '';
    return '<button class="' + cls.join(' ') + '" data-oi="' + oi + '"' + (r ? ' disabled' : '') + '>' +
      '<span class="l">' + LET[j] + '</span><span class="tx' + (mono ? ' mono' : '') + '">' + (p.categoria === 'hueco' ? pinta(p.ops[oi]) : esc(p.ops[oi])) + '</span>' +
      '<span class="marca-op">' + marca + '</span></button>';
  }).join('') + '</div>';
  h += '<div class="veredicto"></div>';
  h += '<div class="solu">';
  if (htmlConsola) h += '<div class="solo-movil">' + htmlConsola + '</div>';
  if (p.sol) h += '<div class="caja porque"><b>POR QUÉ</b>' + esc(p.sol) + '</div>';
  if (p.trampa) h += '<div class="caja trampa"><b>LA TRAMPA</b>' + esc(p.trampa) + '</div>';
  if (o.hayChuleta && p.tema) h += '<button class="ver-chuleta" data-tema="' + esc(p.tema) + '">Repasar esto en la chuleta →</button>';
  h += '</div></div></div>';
  contenedor.innerHTML = h;

  contenedor.querySelectorAll('.op:not([disabled])').forEach(b => b.onclick = () => o.alResponder(+b.dataset.oi));
  const vc = contenedor.querySelector('.ver-chuleta'); if (vc) vc.onclick = () => o.alVerChuleta(vc.dataset.tema);

  function pintarVeredicto(bien) {
    const v = contenedor.querySelector('.veredicto');
    v.className = 'veredicto ' + (bien ? 'bien' : 'fallo');
    v.innerHTML = '<span class="ico">' + (bien ? '✓' : '✗') + '</span>' + (bien ? '¡CORRECTO!' : 'NO ES ESA');
  }
  if (r) pintarVeredicto(r.ok);

  function bloquear() { contenedor.querySelectorAll('.op').forEach(b => { b.disabled = true; }); }

  function mostrarCorreccion(c) {
    resp = { elegida: c.elegida, ok: c.ok };
    contenedor.querySelectorAll('.op').forEach(b => {
      const op = +b.dataset.oi;
      b.disabled = true;
      if (op === c.elegida) b.classList.add('elegida', c.ok ? 'bien' : 'mal');
      b.querySelector('.marca-op').textContent = op === p.ok ? '✓' : (op === c.elegida ? '✗' : '');
    });
    pintarVeredicto(c.ok);
    contenedor.querySelector('.q').classList.add('resuelta');
  }

  return { respuesta: () => resp, bloquear, mostrarCorreccion };
}
