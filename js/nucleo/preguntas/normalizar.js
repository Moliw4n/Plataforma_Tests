/* Núcleo · preguntas/normalizar.js — cómo se comparan las respuestas escritas.
   Es la ÚNICA definición de las reglas. Cuando el servidor corrija (fase 1, paso 4), SQL debe dar los mismos
   resultados: ambos se prueban con los mismos casos de pruebas/vectores-correccion.json. */

/* Texto: sin acentos ni diéresis (la ñ cuenta como n), en minúsculas, sin puntuación ni comillas ni
   paréntesis al principio y al final, y con los espacios de dentro reducidos a uno.
   «  Memoria  RAM. » → «memoria ram» · «Ñandú» → «nandu». */
export function normalizarTexto(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?¡¿"'«»“”()\[\]]+|[\s.,;:!?¡¿"'«»“”()\[\]]+$/g, '');
}

/* Número escrito por una persona: «12», «-3», «+2», «3,5», «3.5», «−4» (con el menos tipográfico).
   Devuelve el número, o null si no es un número. No admite miles («1 000»), espacios por dentro ni notación científica. */
export function parsearNumero(s) {
  const t = String(s ?? '').trim().replace(/\u2212/g, '-');
  if (!/^[+-]?\d+([.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}
