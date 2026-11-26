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

/* Los tests están en tests/<carpeta-de-la-clase>/<id>.json; la carpeta la dice tests/index.json.
   El enlace del alumno sigue siendo ?t=<id>. Si el id no está en el índice (o no hay carpeta),
   se busca en tests/<id>.json como siempre. */
let indiceTests = null;
export async function leerIndiceTests() {
  if (!indiceTests) indiceTests = fetch('tests/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).catch(() => []);
  return indiceTests;
}
export async function rutaTest(id) {
  const e = (await leerIndiceTests()).find(t => t.id === id);
  return 'tests/' + (e && e.carpeta ? encodeURIComponent(e.carpeta) + '/' : '') + encodeURIComponent(id) + '.json';
}
