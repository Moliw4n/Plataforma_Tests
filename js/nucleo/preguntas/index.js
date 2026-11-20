/* Núcleo · preguntas/index.js — registro de los tipos de pregunta que se pueden jugar.
   Cada tipo exporta { pintar, corregir }. Añadir un tipo = un archivo nuevo + una línea aquí
   (y su validación en nucleo/formato.js, que tiene un test que obliga a mantenerlas iguales). */
import * as opcion_multiple from './opcion_multiple.js';
import * as verdadero_falso from './verdadero_falso.js';
import * as numerica from './numerica.js';
import * as respuesta_corta from './respuesta_corta.js';

export const RENDERIZADORES = { opcion_multiple, verdadero_falso, numerica, respuesta_corta };
export const TIPOS_JUGABLES = Object.keys(RENDERIZADORES);

export function renderizador(tipo) {
  const r = RENDERIZADORES[tipo];
  if (!r) throw new Error('Tipo de pregunta sin renderizador: ' + tipo);
  return r;
}
