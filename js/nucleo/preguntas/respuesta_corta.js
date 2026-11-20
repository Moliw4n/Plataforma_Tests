/* Núcleo · preguntas/respuesta_corta.js — respuesta de una palabra o una frase corta (rosco, repaso de vocabulario…)
   Pregunta: { tipo:'respuesta_corta', enun, aceptadas:['ram','memoria ram'], pista?:'Empieza por R', sol, trampa, … }
   Respuesta (dada): el texto escrito. Vale si, normalizado (sin acentos, mayúsculas ni puntuación de los extremos),
   coincide con alguna de las aceptadas, también normalizadas. */
import { esc } from '../util.js';
import { pintarEscrita } from './escrita.js';
import { normalizarTexto } from './normalizar.js';

export function corregir(p, dada) {
  const d = normalizarTexto(dada);
  return { ok: d !== '' && p.aceptadas.some(a => normalizarTexto(a) === d), correcta: p.aceptadas[0] };
}

export function pintar(p, contenedor, o) {
  return pintarEscrita(p, contenedor, o, {
    atributos: 'autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"',
    placeholder: 'Escribe tu respuesta',
    textoCorrecta: q => esc(q.aceptadas[0]) + (q.aceptadas.length > 1 ? ' <small>(también vale: ' + q.aceptadas.slice(1).map(esc).join(', ') + ')</small>' : '')
  });
}
