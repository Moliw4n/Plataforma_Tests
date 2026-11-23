#!/usr/bin/env node
/* Simula una CLASE entera haciendo un examen contra el proyecto de PRUEBAS de Supabase (nunca contra el de verdad).
   Usa los alumnos inventados de supabase/05_datos_prueba.sql (PRUEBA-01…05) y el banco de ensayo (docs/ensayo/banco-ensayo.json).

   Tres fases:
     base       comprobación RÁPIDA del servidor (no necesita ningún examen): los 5 alumnos de prueba entran con su código, un código malo se
                rechaza, el latido responde, las funciones del alumno existen y desde fuera no se puede leer ninguna tabla.
     jugar      5 alumnos a la vez: empiezan, contestan (con distinta puntería, cambios de respuesta y en blanco), salen de la pestaña,
                entregan. Por el camino COMPRUEBA con el servidor de verdad: que no llega ninguna solución, que la nota no se ve antes de
                publicarla y que desde fuera no se puede leer ninguna tabla. Guarda lo que esperaba en un archivo de estado.
     comprobar  (después de publicar las notas en el panel) pide el resultado de cada alumno y lo compara con lo esperado.
     directo    hasta 25 alumnos de prueba entran en una SALA que abres tú en directo.html?entorno=pruebas, contestan a la vez con distintos
                comportamientos (rápidos, lentos, doble toque, se les cae la red, recargan…) y se COMPRUEBA con el servidor de verdad: que no llega
                ninguna solución antes de tiempo, que responder no dice si acertó, que los puntos y el marcador cuadran, que los apodos no se repiten.
                Mide las peticiones por segundo y las esperas.

   Uso:
     node scripts/simular-clase.mjs base      --url https://TU-PROYECTO-DE-PRUEBAS.supabase.co --key sb_publishable_…
     node scripts/simular-clase.mjs jugar     --url https://TU-PROYECTO-DE-PRUEBAS.supabase.co --key sb_publishable_… --juego ID --banco docs/ensayo/banco-ensayo.json
     node scripts/simular-clase.mjs comprobar --url … --key … [--estado ensayo-estado.local.json]
     node scripts/simular-clase.mjs directo   --url … --key … --sala 123456 [--alumnos 25] [--maximo 30]
   Opciones: --alumnos 1..5 (5; en «directo» hasta 25: hacen falta los de supabase/10_alumnos_carga.sql) · --penalizacion 0..1 (0, la del examen) · --estado archivo (ensayo-estado.local.json)

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

if (!['base', 'jugar', 'comprobar', 'directo'].includes(fase) || !op.url || !op.key) SALIR('Uso: node scripts/simular-clase.mjs base|jugar|comprobar|directo --url <URL del proyecto de PRUEBAS> --key <clave publishable> [--juego ID --banco archivo.json]', 2);

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

/* ---------- base: comprobación rápida ---------- */
async function base() {
  console.log('\n● Comprobación rápida del servidor de pruebas: ' + host);
  for (const [k, cod] of CODIGOS.entries()) {
    const r = await rpc('entrar', { p_codigo: cod });
    exige(r.ok === true && r.alumno === 'PRUEBA-0' + (k + 1) && r.grupo === 'PRUEBA', 'el código de prueba ' + (k + 1) + ' entra como PRUEBA-0' + (k + 1));
  }
  const mal = await rpc('entrar', { p_codigo: 'ZZZ999' });
  exige(mal.ok === false && mal.motivo === 'codigo', 'un código que no existe se rechaza («codigo»)');
  const mj = await rpc('mis_juegos', { p_codigo: CODIGOS[0] });
  exige(mj.ok === true && Array.isArray(mj.juegos), 'mis_juegos responde (las funciones del examen están instaladas y la web pública puede llamarlas)');
  const l = await rpc('latido', {});
  exige(l.ok === true, 'latido() responde ok (escribe: ' + l.escrito + ')');
  await seguridad();
  resumen();
}

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

/* ---------- directo ---------- */
async function directo() {
  if (!/^[0-9]{6}$/.test(op.sala || '')) SALIR('Falta --sala <el código de 6 cifras de la sala que has abierto en directo.html?entorno=pruebas>.', 2);
  const n = Math.max(1, Math.min(25, Number(op.alumnos || 25)));
  const sondeo = Math.max(50, Number(op.sondeo || 1500)), sondeoPreg = Math.round(sondeo * 2 / 3);     // como el móvil de verdad: 1,5 s (1 s en una pregunta)
  const fin = Date.now() + Number(op.maximo || 30) * 60000;
  const codigoDe = k => k < 5 ? CODIGOS[k] : 'LOAD' + String(k + 1).padStart(2, '0');
  const llamadas = [];                                                        // {t, fn, ms, ok}
  const medir = async (fn, args) => {
    const t0 = performance.now(), t = Date.now();
    try { const r = await rpc(fn, args); llamadas.push({ t, fn, ms: performance.now() - t0, ok: true }); return r; }
    catch (e) { llamadas.push({ t, fn, ms: performance.now() - t0, ok: false, error: e && (e.tipo || e.message) }); throw e; }
  };
  const vistos = new Map();                                                    // problema → veces (para no repetir el mismo 25 veces)
  const falla = m => vistos.set(m, (vistos.get(m) || 0) + 1);
  console.log('\n● Directo: ' + n + ' alumnos de prueba entran en la sala ' + op.sala + ' de ' + host);

  const PROHIBIDAS = ['trampa', 'reparto', 'aceptadas', 'valor', 'tolerancia', 'run_with', 'salida'];
  const BLANCA = ['clave', 'tipo', 'enun', 'code', 'act', 'categoria', 'pista', 'unidad', 'ops'];
  const recorre = (o, ruta, cb) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { cb(k, ruta); recorre(v, ruta + '.' + k, cb); } };

  const alumnos = Array.from({ length: n }, (_, k) => ({
    k, nombre: 'alumno ' + String(k + 1).padStart(2, '0'), cod: codigoDe(k), sesion: null, apodo: null, puntos: 0, aciertos: 0, suma: 0, resultadosVistos: new Set(),
    enviadasOk: new Set(), tarde: 0, final: null, tareas: [], estados: 0,
    // comportamientos: qué hace cada uno (para que no sean 25 clones)
    lento: k === 0, doble: k % 5 === 1, sinRed: k % 9 === 2, distraido: k % 7 === 3 ? 1 : -1, recarga: k % 10 === 4
  }));
  const log = (a, m) => console.log('  [' + a.nombre + '] ' + m);

  // 1) entrar en la sala
  await Promise.all(alumnos.map(async a => {
    await pausa(a.k * 60);
    let r;
    try { r = await medir('directo_unirse', { p_codigo: a.cod, p_sala: op.sala }); } catch (e) { falla('no ha podido entrar en la sala: ' + (e && e.message)); return; }
    if (!r.ok) { falla(r.motivo === 'codigo' ? a.nombre + ' (' + a.cod + '): el servidor no conoce ese código (¿ejecutaste supabase/10_alumnos_carga.sql?)'
                    : r.motivo === 'sala' ? 'la sala ' + op.sala + ' no existe, ya terminó o no es del grupo PRUEBA' : 'entrar falló: ' + r.motivo); return; }
    a.sesion = r.sesion; a.apodo = r.apodo;
  }));
  const dentro = alumnos.filter(a => a.sesion);
  if (dentro.length < n) {                                                       // si alguien no puede entrar, no tiene sentido empezar la partida: se para ya y se explica
    for (const [m, c] of vistos) fallos.push(m + (c > 1 ? ' (×' + c + ')' : ''));
    fallos.push('solo ' + dentro.length + ' de ' + n + ' alumnos han podido entrar en la sala: no se empieza la partida');
    return resumen();
  }
  ok(dentro.length + ' de ' + n + ' alumnos dentro de la sala');
  exige(new Set(dentro.map(a => a.apodo)).size === dentro.length, 'todos los apodos son distintos (' + dentro.slice(0, 4).map(a => a.apodo).join(', ') + '…)');
  exige(dentro.every(a => !/PRUEBA|\d{2}/.test(a.apodo)), 'ningún apodo lleva el número de alumno');
  const dobles = dentro.filter(a => a.recarga);
  console.log('\n  ▶ AHORA, en directo.html: pulsa «Empezar» y ve pasando las preguntas (Cerrar la pregunta / Siguiente) hasta el final.\n    Este script juega solo y avisará cuando termine.\n');

  let tInicio = null, tFin = null;
  // 2) jugar: cada alumno hace lo que haría su móvil (sondear el estado y contestar)
  await Promise.all(dentro.map(async a => {
    let total = 0;
    while (!a.final && Date.now() < fin) {
      if (a.sinRedHasta && Date.now() < a.sinRedHasta) { await pausa(200); continue; }
      let e;
      try { e = await medir('directo_estado', { p_codigo: a.cod, p_sesion: a.sesion }); } catch (err) { await pausa(1000); continue; }       // un fallo suelto de red: se reintenta como el móvil
      a.estados++;
      if (!e.ok) { if (e.motivo === 'espera') { await pausa(4000); continue; } falla(a.nombre + ': directo_estado respondió ' + e.motivo); break; }
      total = e.total;
      if (e.estado !== 'espera' && tInicio === null) tInicio = Date.now();
      // — lo que el servidor NO debe mandar nunca —
      recorre(e, '', (k, ruta) => {
        if (PROHIBIDAS.includes(k)) falla('el servidor manda «' + k + '» al móvil (' + ruta + ')');
        if ((k === 'sol' || k === 'correcta') && !ruta.startsWith('.resultado')) falla('el servidor manda «' + k + '» fuera del resultado (' + ruta + ') en estado ' + e.estado);
      });
      if (e.estado === 'pregunta' || e.estado === 'espera') {
        if ('resultado' in e) falla('el servidor manda «resultado» con la pregunta abierta');
      }
      if (e.pregunta) {
        const extra = Object.keys(e.pregunta).filter(x => !BLANCA.includes(x));
        if (extra.length) falla('la pregunta lleva campos que no son de la lista blanca: ' + extra.join(', '));
      }
      // — coherencia —
      if (e.apodo !== a.apodo) falla(a.nombre + ': el apodo cambió (' + a.apodo + ' → ' + e.apodo + ')');
      if (e.posicion < 1 || e.posicion > e.participantes) falla(a.nombre + ': posición ' + e.posicion + ' de ' + e.participantes + ' no tiene sentido');
      if (e.puntos < a.puntos || e.aciertos < a.aciertos) falla(a.nombre + ': los puntos o aciertos han BAJADO');
      a.puntos = e.puntos; a.aciertos = e.aciertos;
      if (e.marcador) {
        if (e.marcador.length > 5) falla('el marcador trae más de 5 filas');
        if (e.marcador.some((x, i, v) => i && v[i - 1].puntos < x.puntos)) falla('el marcador no está ordenado por puntos');
        const yo = e.marcador.filter(x => x.yo);
        if (yo.length > 1 || yo.some(x => x.apodo !== a.apodo || x.puntos !== e.puntos)) falla(a.nombre + ': su fila del marcador no es la suya');
      }
      // — jugar —
      if (e.estado === 'pregunta' && !a.enviadasOk.has(e.actual) && !(a.planeadas || (a.planeadas = new Set())).has(e.actual)) {
        a.planeadas.add(e.actual);
        if (a.sinRed && !a.yaSinRed) { a.yaSinRed = true; a.sinRedHasta = Date.now() + 4000; log(a, 'se le cae la red 4 s'); }
        if (e.actual !== a.distraido) a.tareas.push(contestar(a, e));
      }
      if (e.estado === 'resultado' && !a.resultadosVistos.has(e.actual)) {
        a.resultadosVistos.add(e.actual);
        const x = e.resultado;
        a.suma += x.puntos;
        if (!x.respondio && x.puntos !== 0) falla(a.nombre + ': no contestó y tiene ' + x.puntos + ' puntos');
        if (x.respondio && x.ok && !(x.puntos >= 500 && x.puntos <= 1000)) falla(a.nombre + ': acertó y le dan ' + x.puntos + ' puntos (debe estar entre 500 y 1000)');
        if (x.respondio && !x.ok && x.puntos !== 0) falla(a.nombre + ': falló y le dan ' + x.puntos + ' puntos');
        if (a.enviadasOk.has(e.actual) && !x.respondio) falla(a.nombre + ': el servidor confirmó su respuesta a la pregunta ' + (e.actual + 1) + ' pero luego dice que no contestó');
        if (!a.enviadasOk.has(e.actual) && x.respondio) falla(a.nombre + ': el servidor tiene una respuesta suya a la pregunta ' + (e.actual + 1) + ' que no llegó a mandar');
        if (a.recarga && !a.yaRecargo) {                      // recarga la página: vuelve a entrar con su código y debe conservar apodo y puntos
          a.yaRecargo = true;
          const r = await medir('directo_unirse', { p_codigo: a.cod, p_sala: op.sala });
          if (!r.ok || r.apodo !== a.apodo) falla(a.nombre + ': al recargar y volver a entrar cambió de apodo (' + a.apodo + ' → ' + r.apodo + ')'); else log(a, 'recarga y conserva su apodo y sus ' + a.puntos + ' puntos');
        }
      }
      if (e.estado === 'terminada') { a.final = e; break; }
      await pausa(e.estado === 'pregunta' ? sondeoPreg : sondeo);
    }
    await Promise.all(a.tareas);
    a.total = total;
  }));
  tFin = Date.now();

  // 3) comprobaciones de la clase entera
  const finales = dentro.filter(a => a.final);
  exige(finales.length === dentro.length, finales.length + ' de ' + dentro.length + ' alumnos llegaron al final de la partida' + (finales.length < dentro.length ? ' (¿se acabó el tiempo máximo de ' + (op.maximo || 30) + ' min? ¿terminaste la sala?)' : ''));
  for (const a of finales) {
    if (a.final.puntos < a.suma) falla(a.nombre + ': tiene menos puntos al final (' + a.final.puntos + ') que la suma de lo que vio pregunta a pregunta (' + a.suma + ')');
    if (a.resultadosVistos.size === a.final.total && a.final.puntos !== a.suma) falla(a.nombre + ': vio todos los resultados y los puntos no cuadran (' + a.final.puntos + ' ≠ ' + a.suma + ')');
  }
  if (finales.length && finales[0].final.participantes === finales.length) {
    for (const a of finales) {
      const mejores = finales.filter(b => b.final.puntos > a.final.puntos).length + 1;
      if (a.final.posicion !== mejores) falla(a.nombre + ': su posición final es ' + a.final.posicion + ' y por sus puntos le toca ' + mejores);
    }
    const esperado = finales.map(a => a.final.puntos).sort((x, y) => y - x).slice(0, 5);
    const visto = (finales[0].final.marcador || []).map(x => x.puntos);
    if (JSON.stringify(esperado) !== JSON.stringify(visto)) falla('el podio final (' + visto.join(', ') + ') no coincide con los puntos de los alumnos (' + esperado.join(', ') + ')');
  }
  const conRespuestas = dentro.reduce((s, a) => s + a.enviadasOk.size, 0);
  ok(conRespuestas + ' respuestas aceptadas en total; ' + dentro.reduce((s, a) => s + a.tarde, 0) + ' llegaron tarde (la pregunta ya estaba cerrada)');
  if (!vistos.size) ok('ninguna solución llegó al móvil antes de tiempo, responder no dijo si acertó, y los puntos, posiciones y marcadores cuadran');

  // 4) tráfico
  informe(llamadas.filter(l => tInicio !== null && l.t >= tInicio), tInicio, tFin, dentro.length);
  await seguridad();
  for (const [m, c] of vistos) fallos.push(m + (c > 1 ? ' (×' + c + ')' : ''));
  resumen();

  async function contestar(a, e) {
    const p = e.pregunta, n1 = e.actual;
    const dada = p.tipo === 'verdadero_falso' ? Math.random() < 0.5 : Math.floor(Math.random() * (p.ops || []).length);
    const margen = e.tiempo_s * 1000;
    await pausa(a.lento ? margen * 0.85 : 400 + Math.random() * Math.min(margen * 0.6, 9000));
    while (a.sinRedHasta && Date.now() < a.sinRedHasta) await pausa(200);
    const mandar = () => medir('directo_responder', { p_codigo: a.cod, p_sesion: a.sesion, p_pregunta: n1, p_dada: dada });
    let r;
    try { r = await mandar(); } catch (err) { await pausa(800); try { r = await mandar(); } catch (e2) { falla(a.nombre + ': no pudo mandar su respuesta (' + (e2 && e2.message) + ')'); return; } }
    if (r.ok) {
      if (Object.keys(r).join() !== 'ok') falla('responder devolvió más de lo debido (dice si acertó): ' + JSON.stringify(r));
      a.enviadasOk.add(n1);
      if (a.doble) {
        const r2 = await mandar().catch(() => null);
        if (!r2 || r2.ok !== false || !['ya_respondida', 'cerrada', 'otra_pregunta'].includes(r2.motivo)) falla(a.nombre + ': contestar dos veces la misma pregunta no fue rechazado (' + JSON.stringify(r2) + ')');
      }
    } else if (r.motivo === 'cerrada' || r.motivo === 'otra_pregunta') a.tarde++;
    else falla(a.nombre + ': responder rechazó la respuesta (' + r.motivo + ')');
  }
}

function informe(ll, t0, t1, alumnos) {
  console.log('\n● Tráfico durante la partida');
  if (!ll.length || !t0) { console.log('  (no hubo partida)'); return; }
  const seg = Math.max(1, Math.round((t1 - t0) / 1000));
  const porSeg = new Map(); for (const l of ll) { const s = Math.floor(l.t / 1000); porSeg.set(s, (porSeg.get(s) || 0) + 1); }
  const pico = Math.max(...porSeg.values());
  const pct = (v, p) => { const o = [...v].sort((a, b) => a - b); return o[Math.min(o.length - 1, Math.floor(o.length * p))]; };
  console.log('  ' + ll.length + ' peticiones en ' + seg + ' s · media ' + (ll.length / seg).toFixed(1) + '/s · PICO ' + pico + ' en un solo segundo · ' + alumnos + ' alumnos');
  for (const fn of [...new Set(ll.map(l => l.fn))]) {
    const v = ll.filter(l => l.fn === fn).map(l => l.ms);
    console.log('  ' + fn.padEnd(18) + String(v.length).padStart(6) + ' peticiones · espera típica ' + Math.round(pct(v, 0.5)) + ' ms · 95 % por debajo de ' + Math.round(pct(v, 0.95)) + ' ms · máxima ' + Math.round(Math.max(...v)) + ' ms');
  }
  const malas = ll.filter(l => !l.ok);
  exige(malas.length === 0, 'ninguna petición falló' + (malas.length ? ' (' + malas.length + ' fallaron: ' + [...new Set(malas.map(l => l.error))].join(', ') + ')' : ''));
  const p95 = pct(ll.map(l => l.ms), 0.95);
  exige(p95 < 3000, 'el 95 % de las peticiones tardan menos de 3 s (salió ' + Math.round(p95) + ' ms)');
  console.log('  (Supabase gratuito no pone un límite fijo de peticiones por segundo a la API REST; el límite de 200 conexiones simultáneas es de Realtime, que aquí no se usa.)');
}

/* ---------- seguridad desde fuera, con la clave pública ---------- */
async function seguridad() {
  console.log('\n● Desde fuera (con la clave pública) no se puede leer ni tocar nada');
  const cab = { apikey: op.key, 'Content-Type': 'application/json' };
  for (const t of ['alumnos', 'intentos', 'grupos', 'profesores', 'accesos_fallidos', 'latidos', 'bancos', 'items', 'juegos', 'asignaciones', 'partidas', 'respuestas', 'eventos', 'directo_sesiones', 'directo_participantes', 'directo_respuestas']) {
    const r = await fetch(url + '/rest/v1/' + t + '?select=*', { headers: cab });
    const cuerpo = await r.json().catch(() => null);
    exige(!(r.status === 200 && Array.isArray(cuerpo) && cuerpo.length > 0), 'tabla «' + t + '»: la web pública no puede leerla (HTTP ' + r.status + ')');
  }
  for (const fn of ['profe_subir_banco', 'profe_resultados', 'profe_publicar_notas', 'profe_borrar_partida', 'profe_estadisticas_examen', '_corregir_item', '_item_alumno', 'profe_directo_crear', 'profe_directo_estado', 'profe_directo_avanzar', 'profe_directo_terminar', 'profe_directo_activas', 'profe_directo_borrar', '_directo_pregunta', '_directo_resultado']) {
    const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: cab, body: '{}' });
    exige(r.status >= 400 && r.status !== 500, '«' + fn + '»: la web pública no puede llamarla (HTTP ' + r.status + ')');
  }
  // Con un filtro (sin filtro PostgREST contesta 400 antes de mirar permisos, y eso no demostraría nada): debe ser un rechazo de PERMISOS
  for (const [metodo, t, cuerpo] of [['DELETE', 'partidas?id=eq.00000000-0000-0000-0000-000000000000'], ['DELETE', 'intentos?id=eq.0'], ['PATCH', 'alumnos?id=eq.PRUEBA-01', '{"activo":false}'], ['POST', 'bancos', '{"id":"x","titulo":"x"}']]) {
    const r = await fetch(url + '/rest/v1/' + t, { method: metodo, headers: cab, body: cuerpo });
    exige(r.status === 401 || r.status === 403, metodo + ' ' + t.split('?')[0] + ' desde fuera: rechazado por permisos (HTTP ' + r.status + ')');
  }
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

try { await (fase === 'base' ? base() : fase === 'jugar' ? jugar() : fase === 'directo' ? directo() : comprobar()); }
catch (e) { SALIR('Ha fallado algo inesperado: ' + (e && e.message ? e.message : e) + (e && e.status ? ' (HTTP ' + e.status + ')' : '')); }
