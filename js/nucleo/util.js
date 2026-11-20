/* Núcleo · util.js — utilidades pequeñas que usa todo el mundo. */
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function barajar(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// «Práctica U1 · Python» → título grande + subtítulo en otra línea
export function tituloBonito(t) {
  const i = t.indexOf('·');
  return i < 0 ? esc(t) : esc(t.slice(0, i).trim()) + '<br><span>' + esc(t.slice(i + 1).trim()) + '</span>';
}
