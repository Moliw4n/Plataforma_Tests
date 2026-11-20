/* Núcleo · preguntas/verdadero_falso.js — «¿Verdadero o falso?».
   Pregunta: { tipo:'verdadero_falso', enun, ok: true|false, sol, trampa, … }
   Respuesta del alumno (dada): true | false.
   Misma interfaz que todos los tipos: pintar(item, contenedor, opciones) → { respuesta(), bloquear(), mostrarCorreccion(c) }
   opciones: { respuesta, chipTipo, hayChuleta, alResponder(dada), alVerChuleta(tema) } · respuesta = {dada, ok} | null */
import { marco, pintarVeredicto, enlazarChuleta } from './comun.js';

export const corregir = (p, dada) => ({ ok: dada === p.ok, correcta: p.ok });

const OPCIONES = [{ v: true, l: 'V', t: 'Verdadero' }, { v: false, l: 'F', t: 'Falso' }];

export function pintar(p, contenedor, o) {
  let resp = o.respuesta || null;
  const r = resp;
  const ops = OPCIONES.map(x => {
    const cls = ['op'];
    if (x.v === p.ok) cls.push('ok');
    if (r && r.dada === x.v) cls.push('elegida', r.ok ? 'bien' : 'mal');
    const marca = r ? (x.v === p.ok ? '✓' : (r.dada === x.v ? '✗' : '')) : '';
    return '<button class="' + cls.join(' ') + '" data-v="' + x.v + '"' + (r ? ' disabled' : '') + '>' +
      '<span class="l">' + x.l + '</span><span class="tx">' + x.t + '</span><span class="marca-op">' + marca + '</span></button>';
  }).join('');
  contenedor.innerHTML = marco(p, o, !!r, '<div class="ops">' + ops + '</div>');
  contenedor.querySelectorAll('.op:not([disabled])').forEach(b => b.onclick = () => o.alResponder(b.dataset.v === 'true'));
  enlazarChuleta(contenedor, o);
  if (r) pintarVeredicto(contenedor, r.ok);

  function bloquear() { contenedor.querySelectorAll('.op').forEach(b => { b.disabled = true; }); }
  function mostrarCorreccion(c) {
    resp = { dada: c.dada, ok: c.ok };
    contenedor.querySelectorAll('.op').forEach(b => {
      const v = b.dataset.v === 'true';
      b.disabled = true;
      if (v === c.dada) b.classList.add('elegida', c.ok ? 'bien' : 'mal');
      b.querySelector('.marca-op').textContent = v === p.ok ? '✓' : (v === c.dada ? '✗' : '');
    });
    pintarVeredicto(contenedor, c.ok);
    contenedor.querySelector('.q').classList.add('resuelta');
  }
  return { respuesta: () => resp, bloquear, mostrarCorreccion };
}
