/* Corrección de los tipos de pregunta y normalización (js/nucleo/preguntas/). Se ejecuta con: npm run test:preguntas
   Los casos están en pruebas/vectores-correccion.json (los comparte el SQL del servidor más adelante). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const V = require('./vectores-correccion.json');

const RAIZ = path.join(__dirname, '..');
const cargar = f => import(pathToFileURL(path.join(RAIZ, 'js', 'nucleo', f)).href);
let N, R, F;
test.before(async () => { N = await cargar('preguntas/normalizar.js'); R = await cargar('preguntas/index.js'); F = await cargar('formato.js'); });

test('normalizarTexto: todos los casos', () => {
  for (const [entrada, esperado] of V.normalizarTexto) assert.equal(N.normalizarTexto(entrada), esperado, JSON.stringify(entrada));
});
test('parsearNumero: todos los casos', () => {
  for (const [entrada, esperado] of V.parsearNumero) assert.equal(N.parsearNumero(entrada), esperado, JSON.stringify(entrada));
});
test('corregir: todos los casos, por tipo', () => {
  assert.ok(V.corregir.length >= 20);
  for (const c of V.corregir) assert.equal(R.renderizador(c.p.tipo).corregir(c.p, c.dada).ok, c.ok, JSON.stringify(c));
});
test('corregir devuelve la respuesta correcta para enseñarla', () => {
  assert.equal(R.RENDERIZADORES.numerica.corregir({ valor: 47 }, '1').correcta, 47);
  assert.equal(R.RENDERIZADORES.respuesta_corta.corregir({ aceptadas: ['ram', 'x'] }, '1').correcta, 'ram');
  assert.equal(R.RENDERIZADORES.verdadero_falso.corregir({ ok: false }, true).correcta, false);
  assert.equal(R.RENDERIZADORES.opcion_multiple.corregir({ ok: 3 }, 0).correcta, 3);
});
test('cada tipo con renderizador es "soportado" por el validador y al revés (no se pueden desincronizar)', () => {
  assert.deepEqual([...F.TIPOS_SOPORTADOS].sort(), [...R.TIPOS_JUGABLES].sort());
  for (const t of R.TIPOS_JUGABLES) { assert.equal(typeof R.RENDERIZADORES[t].pintar, 'function', t); assert.equal(typeof R.RENDERIZADORES[t].corregir, 'function', t); assert.ok(F.TIPOS_CONOCIDOS.includes(t), t); }
});
test('un tipo sin renderizador da un error claro', () => assert.throws(() => R.renderizador('adivinanza'), /sin renderizador/));

test.describe('validarBanco con los tipos nuevos', () => {
  const banco = items => ({ formato: 2, id: 'x', titulo: 'X', preguntas: items.map((p, i) => ({ id: 'q' + (i + 1), enun: 'e', sol: 's', trampa: 't', ...p })) });
  const mal = (p, texto) => { const e = F.validarBanco(banco([p])); assert.ok(e.some(x => x.includes(texto)), JSON.stringify(p) + ' → ' + e.join(' | ')); };
  test('preguntas bien formadas', () => {
    assert.deepEqual(F.validarBanco(banco([
      { tipo: 'verdadero_falso', ok: false }, { tipo: 'numerica', valor: 47 }, { tipo: 'numerica', valor: 3.5, tolerancia: 0.5, unidad: 'kB' },
      { tipo: 'respuesta_corta', aceptadas: ['ram'], pista: 'Empieza por R' }, { tipo: 'opcion_multiple', ops: ['a', 'b'], ok: 1 }])), []);
  });
  test('verdadero_falso: ok debe ser booleano', () => { mal({ tipo: 'verdadero_falso', ok: 'si' }, 'true o false'); mal({ tipo: 'verdadero_falso' }, 'true o false'); });
  test('numerica: valor, tolerancia y unidad', () => {
    mal({ tipo: 'numerica' }, 'valor'); mal({ tipo: 'numerica', valor: '47' }, 'valor'); mal({ tipo: 'numerica', valor: NaN }, 'valor');
    mal({ tipo: 'numerica', valor: 1, tolerancia: -1 }, 'tolerancia'); mal({ tipo: 'numerica', valor: 1, unidad: '' }, 'unidad');
  });
  test('respuesta_corta: aceptadas y pista', () => {
    mal({ tipo: 'respuesta_corta' }, 'aceptadas'); mal({ tipo: 'respuesta_corta', aceptadas: [] }, 'aceptadas');
    mal({ tipo: 'respuesta_corta', aceptadas: ['ok', ''] }, 'aceptadas'); mal({ tipo: 'respuesta_corta', aceptadas: ['a'], pista: 3 }, 'pista');
  });
  test('los tipos del plan que aún no se juegan siguen rechazados', () => { for (const t of ['ordenar', 'emparejar', 'huecos', 'codigo']) mal({ tipo: t }, 'todavía no se puede jugar'); });
});
