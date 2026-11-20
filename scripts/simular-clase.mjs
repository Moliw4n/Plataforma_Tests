#!/usr/bin/env node
/* Simula una CLASE entera haciendo un examen contra el proyecto de PRUEBAS de Supabase (nunca contra el de verdad).
   Usa los alumnos inventados de supabase/05_datos_prueba.sql (PRUEBA-01…05) y el banco de ensayo (docs/ensayo/banco-ensayo.json).

   Dos fases:
     jugar      5 alumnos a la vez: empiezan, contestan (con distinta puntería, cambios de respuesta y en blanco), salen de la pestaña,
                entregan. Por el camino COMPRUEBA con el servidor de verdad: que no llega ninguna solución, que la nota no se ve antes de
                publicarla y que desde fuera no se puede leer ninguna tabla. Guarda lo que esperaba en un archivo de estado.
     comprobar  (después de publicar las notas en el panel) pide el resultado de cada alumno y lo compara con lo esperado.

   Uso:
     node scripts/simular-clase.mjs jugar     --url https://TU-PROYECTO-DE-PRUEBAS.supabase.co --key sb_publishable_… --juego ID --banco docs/ensayo/banco-ensayo.json
     node scripts/simular-clase.mjs comprobar --url … --key … [--estado ensayo-estado.local.json]
   Opciones: --alumnos 1..5 (5) · --penalizacion 0..1 (0, la del examen) · --estado archivo (ensayo-estado.local.json)

   GUARDAS: se niega a funcionar con la URL de producción (la de js/config.js) y con cualquier dirección que no sea localhost o *.supabase.co.
   Solo usa la clave «publishable» (la pública): ni contraseñas ni la clave secret. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../js/nucleo/api.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [fase, ...resto] = process.argv.slice(2);
const op = {};
for (let i = 0; i < resto.length; i += 2) op[resto[i].replace(/^--/, '')] = resto[i + 1];
const SALIR = (msg, codigo = 1) => { console.error('\n✗ ' + msg); process.exit(codigo); };

if (!['jugar', 'comprobar'].includes(fase) || !op.url || !op.key) SALIR('Uso: node scripts/simular-clase.mjs jugar|comprobar --url <URL del proyecto de PRUEBAS> --key <clave publishable> [--juego ID --banco archivo.json]', 2);

/* ---------- guardas ---------- */
const url = op.url.replace(/\/+$/, '');
let host; try { host = new URL(url).hostname; } catch (e) { SALIR('La URL no es válida: ' + op.url); }
const produccion = (fs.readFileSync(path.join(RAIZ, 'js', 'config.js'), 'utf8').match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
if (produccion && url === produccion) SALIR('Esa es la URL de PRODUCCIÓN (la de los alumnos). Este simulador solo vale para el proyecto de PRUEBAS. No se ha hecho nada.');
if (!(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.supabase.co'))) SALIR('Solo se admite localhost o un proyecto *.supabase.co. No se ha hecho nada.');
if (!/^sb_publishable_/.test(op.key) && !/^eyJ/.test(op.key)) SALIR('La clave tiene que ser la «publishable» (empieza por sb_publishable_). Nunca la secret.');
if (/secret|service_role/i.test(op.key)) SALIR('Eso parece una clave secreta. Usa solo la publishable.');

const { rpc } = crearApi({ supabaseUrl: url, supabaseKey: op.key }, { tiempoMs: 20000 });
const ESTADO = path.resolve(op.estado || 'ensayo-estado.local.json');
const CODIGOS = ['AAA222', 'BBB333', 'CCC444', 'DDD555', 'EEE666'];
const ok = m => console.log('  ✓ ' + m), pasos = [];
const fallos = [];
const exige = (cond, msg) => { if (cond) ok(msg); else { fallos.push(msg); console.log('  ✗ ' + msg); } };
const pausa = ms => new Promise(r => setTimeout(r, ms));
const nota = (ac, fa, total, pen) => Math.round(Math.max(0, (ac - pen * fa) / Math.max(total, 1) * 10) * 100) / 100;

/* ---------- jugar ---------- */
async function jugar() {
  if (!op.juego || !op.banco) SALIR('Faltan --juego <id del examen> y --banco <archivo del banco>.', 2);
  const banco = JSON.parse(fs.readFileSync(path.resolve(op.banco), 'utf8'));
  const porId = Object.fromEntries(banco.preguntas.map(p => [p.id, p]));
  const pen = Number(op.penalizacion || 0);
  const n = Math.max(1, Math.min(5, Number(op.alumnos || 5)));
  console.log('\n● Clase simulada: ' + n + ' alumnos de prueba contra ' + host);

  // Cada alumno: qué hará con las preguntas, por orden (bien / mal / en blanco) y si sale de la pestaña
  const PERFILES = [
    { nombre: 'perfecto', bien: 1, mal: 0, salidas: 0 }, { nombre: 'notable', bien: 0.8, mal: 0.2, salidas: 2 },
    { nombre: 'justo', bien: 0.5, mal: 0.25, salidas: 1 }, { nombre: 'flojo', bien: 0.2, mal: 0.8, salidas: 0 }, { nombre: 'en blanco', bien: 0, mal: 0, salidas: 0 }
  ].slice(0, n);

  const resultados = await Promise.all(PERFILES.map(async (perfil, k) => {
    const cod = CODIGOS[k], log = m => console.log('  [' + perfil.nombre + '] ' + m);
    await pausa(k * 150);                                                   // no todos exactamente a la vez, como en clase
    const mj = await rpc('mis_juegos', { p_codigo: cod });
    exige(mj.ok === true, perfil.nombre + ': entra con su código (mis_juegos)');
    const asg = (mj.juegos || []).find(j => j.juego === op.juego);
    if (!asg) { fallos.push(perfil.nombre + ': no tiene asignado el examen «' + op.juego + '» (¿lo has asignado al grupo PRUEBA?)'); return null; }
    if (asg.en_curso || asg.hechos >= asg.intentos) { fallos.push(perfil.nombre + ': ya tenía una partida (¿repites el ensayo? anúlala en el panel o crea otro examen)'); return null; }
    const r = await rpc('empezar_partida', { p_codigo: cod, p_asignacion: asg.asignacion });
    exige(r.ok === true && r.items.length === asg.preguntas, perfil.nombre + ': empieza con ' + asg.preguntas + ' preguntas');
    // el servidor NO debe mandar ninguna solución
    const texto = JSON.stringify(r);
    const filtradas = banco.preguntas.flatMap(p => [p.sol, p.trampa]).filter(t => texto.includes(t));
    exige(filtradas.length === 0, perfil.nombre + ': en las preguntas no llega ni un «por qué» ni una «trampa»');
    exige(!/"(ok|sol|trampa|valor|tolerancia|aceptadas)"\s*:/.test(JSON.stringify(r.items)), perfil.nombre + ': ninguna pregunta trae ok, valor ni respuestas aceptadas');

    const total = r.items.length, nBien = Math.round(perfil.bien * total), nMal = Math.round(perfil.mal * total);
    let aciertos = 0, fallosCont = 0;
    for (const [pos, it] of r.items.entries()) {
      const p = porId[it.clave.split('/').pop()];
      if (!p) { fallos.push('pregunta ' + it.clave + ' no está en el banco indicado'); continue; }
      const hacer = pos < nBien ? 'bien' : pos < nBien + nMal ? 'mal' : 'blanco';
      if (hacer === 'blanco') continue;
      const dada = respuesta(it, p, hacer === 'bien');
      if (pos === 1 && hacer === 'bien') await rpc('responder', { p_codigo: cod, p_partida: r.partida, p_item: it.clave, p_dada: respuesta(it, p, false), p_ms: 900 });   // se equivoca y rectifica
      const x = await rpc('responder', { p_codigo: cod, p_partida: r.partida, p_item: it.clave, p_dada: dada, p_ms: 1500 + pos * 100 });
      if (!x.ok) { fallos.push(perfil.nombre + ': responder rechazó ' + it.clave + ' (' + x.motivo + ')'); continue; }
      if (Object.keys(x).sort().join() !== 'ok,restante_s') fallos.push(perfil.nombre + ': responder devolvió más de lo debido: ' + JSON.stringify(x));
      if (hacer === 'bien') aciertos++; else fallosCont++;
    }
    for (let s = 0; s < perfil.salidas; s++) { await rpc('evento', { p_codigo: cod, p_partida: r.partida, p_tipo: 'salida' }); await rpc('evento', { p_codigo: cod, p_partida: r.partida, p_tipo: 'vuelta', p_detalle: { segundos: 10 + s } }); }
    const t = await rpc('terminar_partida', { p_codigo: cod, p_partida: r.partida });
    exige(t.ok === true && t.estado === 'entregada', perfil.nombre + ': entrega (' + aciertos + ' bien, ' + fallosCont + ' mal, ' + (total - aciertos - fallosCont) + ' en blanco)');
    exige(!('nota' in t), perfil.nombre + ': al entregar NO se le dice la nota');
    const mr = await rpc('mi_resultado', { p_codigo: cod, p_partida: r.partida });
    if (!mr.publicada) exige(!('nota' in mr) && !('aciertos' in mr), perfil.nombre + ': antes de publicar, mi_resultado no enseña nota ni aciertos');
    log('esperado: nota ' + nota(aciertos, fallosCont, total, pen).toFixed(2).replace('.', ','));
    return { codigo: cod, alumno: 'PRUEBA-0' + (k + 1), perfil: perfil.nombre, partida: r.partida, asignacion: asg.asignacion, aciertos, fallos: fallosCont, total, nota: nota(aciertos, fallosCont, total, pen), salidas: perfil.salidas };
  }));

  await seguridad();
  const buenos = resultados.filter(Boolean);
  fs.writeFileSync(ESTADO, JSON.stringify({ creado: new Date().toISOString(), url, juego: op.juego, penalizacion: pen, alumnos: buenos }, null, 2));
  console.log('\n● Guardado lo esperado en ' + path.relative(process.cwd(), ESTADO));
  console.log('\n  AHORA, en el panel (panel.html?entorno=pruebas): Ver resultados del examen «' + op.juego + '» → comprueba salidas de pestaña y notas → «Publicar las notas».');
  console.log('  Después: node scripts/simular-clase.mjs comprobar --url ' + url + ' --key <la clave>\n');
  resumen();
}
// Lo que contestaría un alumno: bien o mal, por posición en opción múltiple
function respuesta(it, p, bien) {
  if (p.tipo === 'opcion_multiple') { const buena = it.ops.indexOf(p.ops[p.ok]); return bien ? buena : (buena + 1) % it.ops.length; }
  if (p.tipo === 'verdadero_falso') return bien ? p.ok : !p.ok;
  if (p.tipo === 'numerica') return bien ? String(p.valor).replace('.', ',') : String(p.valor + 7);
  return bien ? p.aceptadas[0].toUpperCase() + ' ' : 'zzz';
}

/* ---------- seguridad desde fuera, con la clave pública ---------- */
async function seguridad() {
  console.log('\n● Desde fuera (con la clave pública) no se puede leer ni tocar nada');
  const cab = { apikey: op.key, 'Content-Type': 'application/json' };
  for (const t of ['alumnos', 'intentos', 'grupos', 'profesores', 'accesos_fallidos', 'latidos', 'bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos']) {
    const r = await fetch(url + '/rest/v1/' + t + '?select=*', { headers: cab });
    const cuerpo = await r.json().catch(() => null);
    exige(!(r.status === 200 && Array.isArray(cuerpo) && cuerpo.length > 0), 'tabla «' + t + '»: la web pública no puede leerla (HTTP ' + r.status + ')');
  }
  for (const fn of ['profe_subir_banco', 'profe_resultados', 'profe_publicar_notas', 'profe_borrar_partida', 'profe_estadisticas_examen', '_corregir_item', '_item_alumno']) {
    const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: cab, body: '{}' });
    exige(r.status >= 400 && r.status !== 500, '«' + fn + '»: la web pública no puede llamarla (HTTP ' + r.status + ')');
  }
  const r = await fetch(url + '/rest/v1/partidas', { method: 'DELETE', headers: cab });
  exige(r.status >= 400, 'borrar partidas desde fuera: rechazado (HTTP ' + r.status + ')');
}

/* ---------- comprobar ---------- */
async function comprobar() {
  if (!fs.existsSync(ESTADO)) SALIR('No encuentro ' + ESTADO + '. Primero ejecuta la fase «jugar».', 2);
  const est = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
  if (est.url !== url) SALIR('El archivo de estado es de otro proyecto (' + est.url + ').');
  console.log('\n● Comprobando las notas de ' + est.alumnos.length + ' alumnos (examen «' + est.juego + '»)');
  let sinPublicar = 0;
  for (const a of est.alumnos) {
    const r = await rpc('mi_resultado', { p_codigo: a.codigo, p_partida: a.partida });
    if (!r.ok) { fallos.push(a.perfil + ': mi_resultado falló (' + r.motivo + ')'); continue; }
    if (!r.publicada || r.nota === undefined) { sinPublicar++; console.log('  … ' + a.perfil + ': la nota aún no está publicada'); continue; }
    exige(Math.abs(Number(r.nota) - a.nota) < 0.011 && r.aciertos === a.aciertos && r.total === a.total,
      a.perfil + ': nota ' + String(r.nota).replace('.', ',') + ' (' + r.aciertos + '/' + r.total + ') = lo esperado ' + a.nota.toFixed(2).replace('.', ',') + ' (' + a.aciertos + '/' + a.total + ')');
  }
  if (sinPublicar) { console.log('\n  Falta publicar las notas en el panel (Ver resultados → «Publicar las notas») y volver a lanzar este comando.\n'); process.exit(2); }
  resumen();
}

function resumen() {
  if (fallos.length) { console.log('\n✗ HAY ' + fallos.length + ' PROBLEMA(S):'); fallos.forEach(f => console.log('   - ' + f)); process.exit(1); }
  console.log('\n✓ Todo correcto.\n');
}

try { await (fase === 'jugar' ? jugar() : comprobar()); }
catch (e) { SALIR('Ha fallado algo inesperado: ' + (e && e.message ? e.message : e) + (e && e.status ? ' (HTTP ' + e.status + ')' : '')); }
