/* CONTRATO: el servidor falso del directo (usado por las pruebas de la web) y el SQL real (supabase/09_directo.sql) tienen que
   responder con LA MISMA FORMA en cada paso del mismo guion. Si alguien cambia una función de SQL y no el falso (o al revés),
   esta prueba falla y las pruebas de la web dejan de mentir. Se ejecuta con: npm run test:sql */
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, parar, baseNueva, como, comoUsuario } = require('./ayuda-sql');
const { bancoDePrueba } = require('./servidor-examen-falso');
const { crearServidorDirecto } = require('./servidor-directo-falso');

const PROFE = 'profe@ejemplo.test';
const forma = v => v === null ? null : Array.isArray(v) ? (v.length ? [forma(v[0])] : []) : typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, forma(v[k])])) : typeof v;
function compatibles(a, b, ruta = '') {
  if (a === null || b === null) return null;
  if (ruta.endsWith('.correcta') || ruta.endsWith('.dada') || ruta.endsWith('.mi_dada')) return null;     // número (opción múltiple) o booleano (verdadero/falso)
  if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b)) return ruta + ': uno es lista y el otro no'; return a.length && b.length ? compatibles(a[0], b[0], ruta + '[]') : null; }
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== typeof b) return ruta + ': uno es objeto y el otro no';
    const ka = Object.keys(a).sort().join(), kb = Object.keys(b).sort().join();
    if (ka !== kb) return ruta + ': claves distintas · falso {' + ka + '} · real {' + kb + '}';
    for (const k of Object.keys(a)) { const r = compatibles(a[k], b[k], ruta + '.' + k); if (r) return r; }
    return null;
  }
  return typeof a === typeof b ? null : ruta + ': tipo distinto · falso ' + typeof a + ' · real ' + typeof b;
}
const ambos = (nombre, real, falso) => {
  const dif = compatibles(falso, real, nombre);
  assert.equal(dif, null, nombre + ' → ' + dif + '\n  falso: ' + JSON.stringify(forma(falso)) + '\n  real:  ' + JSON.stringify(forma(real)));
};

let c;
test.before(async () => {
  await iniciar();
  c = await baseNueva('contratodirecto', ['01_esquema.sql', '03_profesor_alumnos.sql', '04_latido.sql', '06_contenido.sql', '07_examen.sql', '09_directo.sql']);
  await c.query('insert into profesores(email) values ($1)', [PROFE]);
  await c.query("insert into grupos(id, nombre) values ('TDA2', 'TDA II'), ('TDA1', 'TDA I')");
  await c.query("insert into alumnos(id, grupo, codigo_hash) values ('TDA2-01', 'TDA2', public._hash_codigo('AAA222')), ('TDA2-02', 'TDA2', public._hash_codigo('BBB333')), ('TDA1-01', 'TDA1', public._hash_codigo('CCC444'))");
  // Dos bancos con las mismas preguntas que usa el falso, separados por tipo para que la forma de la pregunta sea estable
  const b = bancoDePrueba();
  const solo = (id, filtro) => ({ ...b, id, preguntas: b.preguntas.filter(filtro) });
  await comoUsuario(c, PROFE, 'select public.profe_subir_banco($1::jsonb)', [JSON.stringify(solo('gmc', p => p.tipo === 'opcion_multiple'))]);
  await comoUsuario(c, PROFE, 'select public.profe_subir_banco($1::jsonb)', [JSON.stringify(solo('gvf', p => p.tipo === 'verdadero_falso'))]);
});
test.after(parar);

const real = {
  unirse: async (cod, sala) => (await como(c, 'anon', 'select public.directo_unirse($1, $2) as r', [cod, sala])).rows[0].r,
  estado: async (cod, ses) => (await como(c, 'anon', 'select public.directo_estado($1, $2::uuid) as r', [cod, ses])).rows[0].r,
  responder: async (cod, ses, q, dada) => (await como(c, 'anon', 'select public.directo_responder($1, $2::uuid, $3::int, $4::jsonb) as r', [cod, ses, q, JSON.stringify(dada)])).rows[0].r,
  profe: async (fn, ...a) => (await comoUsuario(c, PROFE, 'select public.' + fn + '(' + a.map((_, i) => '$' + (i + 1)).join(', ') + ') as r', a)).rows[0].r
};

// El mismo guion contra el SQL real y contra el falso: 3 preguntas del banco indicado
async function guion(banco, ids, contestarBien) {
  await c.query('truncate directo_respuestas, directo_participantes, directo_sesiones cascade');
  const sala = await real.profe('profe_directo_crear', JSON.stringify({ grupo: 'TDA2', bancos: [banco], preguntas: 3, tiempo_s: 30 }));
  const falso = await crearServidorDirecto({ preguntas: ids, tiempoS: 30, sala: sala.sala });
  const F = (fn, a) => falso.llamar(fn, a);
  const A = 'AAA222', B = 'BBB333', X = 'CCC444';
  const dadaBuena = banco === 'gmc' ? 1 : true, dadaMala = banco === 'gmc' ? 0 : false;

  // 1) entrar: bien, mal código, sala inexistente, otro grupo
  ambos('unirse ok', await real.unirse(A, sala.sala), F('directo_unirse', { p_codigo: A, p_sala: sala.sala }));
  ambos('unirse (otra vez)', await real.unirse(A, sala.sala), F('directo_unirse', { p_codigo: A, p_sala: sala.sala }));
  ambos('unirse código malo', await real.unirse('ZZZ999', sala.sala), F('directo_unirse', { p_codigo: 'ZZZ999', p_sala: sala.sala }));
  ambos('unirse sala mala', await real.unirse(A, '999999'), F('directo_unirse', { p_codigo: A, p_sala: '999999' }));
  ambos('unirse otro grupo', await real.unirse(X, sala.sala), F('directo_unirse', { p_codigo: X, p_sala: sala.sala }));
  // 2) estados
  ambos('estado en espera', await real.estado(A, sala.sesion), F('directo_estado', { p_codigo: A, p_sesion: falso.sesion }));
  ambos('estado: no participa', await real.estado(B, sala.sesion), F('directo_estado', { p_codigo: B, p_sesion: falso.sesion }));
  ambos('estado: otro grupo', await real.estado(X, sala.sesion), F('directo_estado', { p_codigo: X, p_sesion: falso.sesion }));
  ambos('estado: código malo', await real.estado('ZZZ999', sala.sesion), F('directo_estado', { p_codigo: 'ZZZ999', p_sesion: falso.sesion }));
  ambos('responder sin empezar', await real.responder(A, sala.sesion, 0, dadaBuena), F('directo_responder', { p_codigo: A, p_sesion: falso.sesion, p_pregunta: 0, p_dada: dadaBuena }));
  // 3) pregunta abierta
  ambos('avanzar', await real.profe('profe_directo_avanzar', sala.sesion, 'espera'), falso.avanzar('espera'));
  ambos('estado en pregunta (sin contestar)', await real.estado(A, sala.sesion), F('directo_estado', { p_codigo: A, p_sesion: falso.sesion }));
  ambos('responder bien', await real.responder(A, sala.sesion, 0, dadaBuena), F('directo_responder', { p_codigo: A, p_sesion: falso.sesion, p_pregunta: 0, p_dada: dadaBuena }));
  ambos('responder otra vez', await real.responder(A, sala.sesion, 0, dadaMala), F('directo_responder', { p_codigo: A, p_sesion: falso.sesion, p_pregunta: 0, p_dada: dadaMala }));
  ambos('responder otra pregunta', await real.responder(A, sala.sesion, 7, dadaMala), F('directo_responder', { p_codigo: A, p_sesion: falso.sesion, p_pregunta: 7, p_dada: dadaMala }));
  ambos('responder no participa', await real.responder(B, sala.sesion, 0, dadaMala), F('directo_responder', { p_codigo: B, p_sesion: falso.sesion, p_pregunta: 0, p_dada: dadaMala }));
  ambos('responder dato raro', await real.responder(A, sala.sesion, 0, 'x'), F('directo_responder', { p_codigo: A, p_sesion: falso.sesion, p_pregunta: 0, p_dada: 'x' }));
  ambos('estado en pregunta (contestada)', await real.estado(A, sala.sesion), F('directo_estado', { p_codigo: A, p_sesion: falso.sesion }));
  // 4) resultado: uno que acertó y otro que entra tarde y no contesta
  ambos('unirse tarde', await real.unirse(B, sala.sala), F('directo_unirse', { p_codigo: B, p_sala: sala.sala }));
  ambos('cerrar ya', await real.profe('profe_directo_avanzar', sala.sesion, 'pregunta'), falso.avanzar('pregunta'));
  ambos('estado en resultado (acertó)', await real.estado(A, sala.sesion), F('directo_estado', { p_codigo: A, p_sesion: falso.sesion }));
  ambos('estado en resultado (no contestó)', await real.estado(B, sala.sesion), F('directo_estado', { p_codigo: B, p_sesion: falso.sesion }));
  ambos('responder con la pregunta cerrada', await real.responder(B, sala.sesion, 0, dadaBuena), F('directo_responder', { p_codigo: B, p_sesion: falso.sesion, p_pregunta: 0, p_dada: dadaBuena }));
  // 5) un fallo, para ver la forma de «ok: false»
  ambos('avanzar a la 2.ª', await real.profe('profe_directo_avanzar', sala.sesion, 'resultado'), falso.avanzar('resultado'));
  ambos('responder mal', await real.responder(B, sala.sesion, 1, dadaMala), F('directo_responder', { p_codigo: B, p_sesion: falso.sesion, p_pregunta: 1, p_dada: dadaMala }));
  ambos('cerrar la 2.ª', await real.profe('profe_directo_avanzar', sala.sesion, 'pregunta'), falso.avanzar('pregunta'));
  ambos('estado en resultado (falló)', await real.estado(B, sala.sesion), F('directo_estado', { p_codigo: B, p_sesion: falso.sesion }));
  // 6) final
  await real.profe('profe_directo_avanzar', sala.sesion, 'resultado'); falso.avanzar('resultado');
  await real.profe('profe_directo_avanzar', sala.sesion, 'pregunta'); falso.avanzar('pregunta');
  await real.profe('profe_directo_avanzar', sala.sesion, 'resultado'); falso.avanzar('resultado');
  ambos('estado terminada', await real.estado(A, sala.sesion), F('directo_estado', { p_codigo: A, p_sesion: falso.sesion }));
  ambos('responder con la sala terminada', await real.responder(A, sala.sesion, 2, dadaBuena), F('directo_responder', { p_codigo: A, p_sesion: falso.sesion, p_pregunta: 2, p_dada: dadaBuena }));
  ambos('unirse a una sala terminada', await real.unirse(A, sala.sala), F('directo_unirse', { p_codigo: A, p_sala: sala.sala }));
}

test('el falso y el SQL real responden con la misma forma en cada paso del directo (preguntas de opción múltiple)', () => guion('gmc', ['t1mc', 't2mc', 't3mc'], true));
test('lo mismo con preguntas de verdadero/falso', () => guion('gvf', ['t1vf', 't2vf', 't3vf'], true));
