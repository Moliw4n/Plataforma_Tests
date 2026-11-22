/* Núcleo · preguntas/numerica.js — «¿Cuánto vale…?»
   Pregunta: { tipo:'numerica', enun, valor:number, tolerancia?:number (≥0, por defecto 0), unidad?:'kB', sol, trampa, … }
   Respuesta (dada): el texto escrito. Vale si |número − valor| ≤ tolerancia. Se admite coma o punto decimal. */
import { esc } from '../util.js';
import { pintarEscrita } from './escrita.js';
import { parsearNumero } from './normalizar.js';

export function corregir(p, dada) {
  const n = parsearNumero(dada);
  const tol = p.tolerancia || 0;
  return { ok: n !== null && Math.abs(n - p.valor) <= tol + 1e-9, correcta: p.valor };
}

const coma = n => String(n).replace('.', ',');

export function pintar(p, contenedor, o) {
  return pintarEscrita(p, contenedor, o, {
    atributos: 'inputmode="decimal" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false"',
    placeholder: 'Escribe un número',
    unidad: p.unidad,
    aviso: texto => parsearNumero(texto) === null ? 'Escribe solo un número, por ejemplo 12 o 3,5.' : null,
    textoCorrecta: q => esc(coma(q.valor)) + (q.unidad ? ' ' + esc(q.unidad) : '') +
      (q.tolerancia ? ' <small>(se acepta ±' + esc(coma(q.tolerancia)) + ')</small>' : '')
  });
}
