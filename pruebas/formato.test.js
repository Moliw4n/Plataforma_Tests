/* Formato 2, conversor y validador (js/nucleo/formato.js). Se ejecuta con: npm run test:formato */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
// Las pruebas de CONVERSIÓN parten de copias congeladas del formato 1 (los de tests/ ya están en formato 2)
const leer = id => JSON.parse(fs.readFileSync(path.join(__dirname, 'datos', id + '.formato1.json'), 'utf8'));
const leerDisco = id => JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests', id + '.json'), 'utf8'));
const IDS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests', 'index.json'), 'utf8')).map(t => t.id);
let F;
test.before(async () => { F = await import(path.join(RAIZ, 'js', 'nucleo', 'formato.js')); });
const clon = o => JSON.parse(JSON.stringify(o));

test('el índice y los archivos de tests coinciden', () => {
  assert.ok(IDS.length >= 2);
  for (const id of IDS) assert.equal(leerDisco(id).id, id);
});

test('los tests de tests/*.json están en formato 2, son válidos y equivalen exactamente al formato 1 de siempre', () => {
  for (const id of IDS) {
    const t = leerDisco(id);
    assert.equal(t.formato, 2, id);
    assert.deepEqual(F.validarBanco(t), [], id);
    assert.deepEqual(F.aFormato1(t), leer(id), id + ': el formato 2 de disco pierde algo respecto al formato 1');
    assert.deepEqual(t, F.aFormato2(leer(id)), id + ': no coincide con convertir el antiguo');
  }
});

for (const id of ['tda2-u1-python-practica', 'tda1-u1u2-repaso']) {
  test.describe(id, () => {
    test('formato 1 → 2: misma cantidad de preguntas, tipo opcion_multiple y la categoría de antes', () => {
      const t1 = leer(id), t2 = F.aFormato2(t1);
      assert.equal(t2.formato, 2);
      assert.equal(t2.preguntas.length, t1.preguntas.length);
      t1.preguntas.forEach((p, i) => {
        const q = t2.preguntas[i];
        assert.equal(q.tipo, 'opcion_multiple');
        assert.equal(q.categoria, p.tipo);
        for (const k of Object.keys(p)) if (k !== 'tipo') assert.deepEqual(q[k], p[k], 'se perdió ' + k + ' en ' + p.id);
      });
      if (t1.tipos) assert.deepEqual(t2.categorias, t1.tipos); else assert.equal(t2.categorias, undefined);
      assert.equal(t2.tipos, undefined);
    });

    test('convertir y volver deja EXACTAMENTE el original (no se pierde nada)', () => {
      const t1 = leer(id);
      assert.deepEqual(F.aFormato1(F.aFormato2(t1)), t1);
    });

    test('es idempotente y no modifica el original', () => {
      const t1 = leer(id), copia = clon(t1);
      const t2 = F.aFormato2(t1);
      assert.deepEqual(t1, copia);
      assert.deepEqual(F.aFormato2(t2), t2);
      assert.equal(F.aFormato2(t2), t2);
    });

    test('el resultado pasa la validación sin ningún problema', () => {
      assert.deepEqual(F.validarBanco(F.aFormato2(leer(id))), []);
    });

    test('la herramienta de línea de órdenes valida y comprueba', () => {
      const f = path.join(__dirname, 'datos', id + '.formato1.json');
      for (const orden of ['validar', 'comprobar']) {
        const r = spawnSync('node', ['scripts/formato.mjs', orden, f], { cwd: RAIZ, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr + r.stdout);
      }
    });
  });
}

test('el banco de ENSAYO (docs/ensayo) es válido, usa los 4 tipos y no trae nada personal ni real', () => {
  const b = JSON.parse(fs.readFileSync(path.join(RAIZ, 'docs', 'ensayo', 'banco-ensayo.json'), 'utf8'));
  assert.deepEqual(F.validarBanco(b), []);
  assert.deepEqual([...new Set(b.preguntas.map(p => p.tipo))].sort(), ['numerica', 'opcion_multiple', 'respuesta_corta', 'verdadero_falso']);
  assert.equal(b.preguntas.length, 20);
  assert.deepEqual([...new Set(b.preguntas.map(p => p.tema))].sort(), ['binario', 'hardware', 'so', 'unidades']);
  assert.ok(b.preguntas.every(p => p.criterio && p.dificultad && p.sol && p.trampa));
  assert.match(b.titulo, /ENSAYO/);
});

test.describe('validarBanco', () => {
  const base = () => clon(F.aFormato2(leer('tda1-u1u2-repaso')));
  const con = (cambia, opciones) => { const t = base(); cambia(t); return F.validarBanco(t, opciones); };
  const tiene = (lista, texto) => assert.ok(lista.some(x => x.includes(texto)), 'esperaba «' + texto + '» en:\n' + lista.join('\n'));

  test('un test en formato 1 se rechaza pidiendo convertirlo', () => tiene(F.validarBanco(leer('tda1-u1u2-repaso')), 'formato: 2'));
  test('faltan id o título', () => { tiene(con(t => { delete t.id; }), 'Falta el id'); tiene(con(t => { delete t.titulo; }), 'Falta el título'); });
  test('id del banco con caracteres raros', () => tiene(con(t => { t.id = '../x'; }), 'solo puede llevar'));
  test('sin preguntas', () => tiene(con(t => { t.preguntas = []; }), 'No hay preguntas'));
  test('id de pregunta repetido', () => tiene(con(t => { t.preguntas[1].id = t.preguntas[0].id; }), 'repetido'));
  test('tipo desconocido y tipo todavía no jugable', () => {
    tiene(con(t => { t.preguntas[0].tipo = 'adivinanza'; }), 'desconocido');
    tiene(con(t => { t.preguntas[0].tipo = 'ordenar'; }), 'todavía no se puede jugar');
    assert.deepEqual(con(t => { t.preguntas[0].tipo = 'opcion_multiple'; }), []);
  });
  test('«ok» fuera de rango o no entero', () => {
    tiene(con(t => { t.preguntas[0].ok = 4; }), 'ok debe ser');
    tiene(con(t => { t.preguntas[0].ok = '1'; }), 'ok debe ser');
    tiene(con(t => { t.preguntas[0].ok = -1; }), 'ok debe ser');
  });
  test('pocas opciones', () => tiene(con(t => { t.preguntas[0].ops = ['solo una']; }), '2 a 6'));
  test('sin «sol» o «trampa»: error, salvo que se pida lo contrario', () => {
    tiene(con(t => { delete t.preguntas[0].sol; }), 'sol');
    tiene(con(t => { t.preguntas[0].trampa = '  '; }), 'trampa');
    assert.deepEqual(con(t => { delete t.preguntas[0].sol; delete t.preguntas[0].trampa; }, { exigirSolTrampa: false }), []);
  });
  test('metadatos opcionales: dificultad, criterio, etiquetas', () => {
    assert.deepEqual(con(t => { Object.assign(t.preguntas[0], { dificultad: 2, criterio: '2.1', etiquetas: ['binario', 'hex'] }); }), []);
    tiene(con(t => { t.preguntas[0].dificultad = 5; }), 'dificultad');
    tiene(con(t => { t.preguntas[0].criterio = 21; }), 'criterio');
    tiene(con(t => { t.preguntas[0].etiquetas = 'binario'; }), 'etiquetas');
  });
  test('categoría que no existe en «categorias»', () => tiene(con(t => { t.preguntas[0].categoria = 'inventada'; }), 'no está en «categorias»'));
  test('lo desconocido se conserva y no da error', () => assert.deepEqual(con(t => { t.preguntas[0].run_with = 'x'; t.otra_cosa = 1; }), []));
});
