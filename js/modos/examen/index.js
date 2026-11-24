/* Modo EXAMEN — las preguntas las manda el SERVIDOR (sin soluciones), el servidor corrige y manda el tiempo.
   Aquí no hay corrección a la vista: el alumno contesta, puede volver atrás y cambiar hasta entregar, y la nota
   la verá cuando el profesor la publique. Funciones del servidor (supabase/07_examen.sql):
   empezar_partida (también reanuda), responder, evento, terminar_partida, mi_resultado, mis_juegos.
   Pensado para fallar bien: si se cae internet las respuestas esperan y se reenvían solas; si recarga, continúa donde iba. */
import { esc, tituloBonito } from '../../nucleo/util.js';
import { TIPOS_JUGABLES, renderizador } from '../../nucleo/preguntas/index.js';
import { chipPorDefecto, categoriaDe } from '../../nucleo/preguntas/comun.js';

const $ = s => document.querySelector(s);
// Ajustes SOLO para las pruebas (window.KIRON_AJUSTES); en producción valen los de siempre
const AJUSTES = window.KIRON_AJUSTES || {};
const REINTENTO_MS = AJUSTES.reintentoMs || 3000;          // cada cuánto se reenvían las respuestas que no han llegado
const ESPERA_ENTREGA_MS = AJUSTES.esperaEntregaMs || 15000; // cuánto espera al entregar a que se guarden todas

/* ---------- estado (un solo examen activo a la vez) ---------- */
let ctx, E, barra, avisos;
let juego = null;           // la asignación, tal como la da mis_juegos()
let partida = null;         // lo que devolvió empezar_partida()
let items = [], pos = 0, vista = null;
let resp = {};              // clave → lo que contestó (posición en opción múltiple, true/false o texto)
let acumMs = {};            // clave → milisegundos que lleva mirando esa pregunta
let t0 = 0, inicio = 0;
let limiteLocal = 0;        // instante (Date.now()) en que se acaba, corregido con el reloj del servidor
let relojId = null, reintentoId = null;
let pendientes = new Map(), enVuelo = new Set();
let sinRedDesde = null, salidas = 0, fueraDesde = null, focoDesde = null, focos = 0;
let activo = false, entregando = false, acabado = false;
let aviso1 = null;

const codigo = () => ctx.alumno.codigo;
const llamar = (fn, args, opciones) => ctx.api.rpc(fn, { p_codigo: codigo(), ...args }, opciones);
const pad = n => String(n).padStart(2, '0');
const fmtTiempo = s => (s >= 3600 ? Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60)) : pad(Math.floor(s / 60))) + ':' + pad(s % 60);
// Postgres da las horas con microsegundos y zona («…47.836465+01:00»): se recortan a milisegundos para que todos los navegadores las entiendan
const fmtFecha = iso => new Date(String(iso).replace(/(\.\d{3})\d+/, '$1')).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
const respondidas = () => items.filter(i => resp[i.clave] !== undefined).length;

/* ---------- avisos (arriba, fuera de la pregunta) ---------- */
function aviso(texto, { rojo = false, id = null, segundos = 0 } = {}) {
  if (!avisos) return;
  let el = id ? avisos.querySelector('[data-id="' + id + '"]') : null;
  if (!el) { el = document.createElement('div'); if (id) el.dataset.id = id; avisos.appendChild(el); }
  el.className = 'aviso-examen' + (rojo ? ' rojo' : '');
  el.setAttribute('role', rojo ? 'alert' : 'status');
  el.textContent = texto;
  if (segundos) setTimeout(() => el.isConnected && el.remove(), segundos * 1000);
}
const quitarAviso = id => { const el = avisos && avisos.querySelector('[data-id="' + id + '"]'); if (el) el.remove(); };

/* ---------- portada ---------- */
async function portada(mensaje) {
  $('#bot').hidden = true; $('#reloj').hidden = true; barra.innerHTML = ''; $('#contador').textContent = '';
  E.innerHTML = '<div class="cargando">Un momento…</div>';
  let r;
  try { r = await llamar('mis_juegos', {}, { reintentos: 1 }); }
  catch (e) { return pintarPortada(null, 'No hay conexión con el servidor. Comprueba internet y vuelve a probar.'); }
  if (!r.ok) return pintarPortada(null, 'No he podido comprobar tu código. Vuelve a entrar.');
  const j = (r.juegos || []).find(x => x.asignacion === ctx.juego.asignacion);
  if (!j) return pintarPortada(null, 'Este examen ya no está asignado a tu grupo. Avisa a tu profesor.');
  juego = j;
  pintarPortada(j, mensaje);
}

// «Has hecho 1 de 2. Te queda 1.» / «Estás en el intento 2 de 2.»: cuántos lleva y cuántos le quedan
function textoIntentos(j, nint) {
  const hechos = j.hechos || 0;
  if (j.en_curso) return ' Estás en el intento ' + Math.min(hechos + 1, nint) + ' de ' + nint + '.';
  if (!hechos) return '';
  const quedan = Math.max(0, nint - hechos);
  return ' <b class="intentos-ex">Has hecho ' + hechos + ' de ' + nint + '. ' + (quedan === 0 ? 'No te quedan más.' : quedan === 1 ? 'Te queda 1.' : 'Te quedan ' + quedan + '.') + '</b>';
}
function pintarPortada(j, mensaje) {
  const info = j || ctx.juego;
  const n = info.preguntas, t = info.tiempo_min, nint = info.intentos;
  const hecho = j && j.hechos >= j.intentos && !j.en_curso;
  const ultima = j && j.partidas && j.partidas.filter(p => p.estado !== 'en_curso').slice(-1)[0];
  let boton = '', estado = '';
  if (!j) estado = '';
  else if (j.en_curso) { boton = 'Continuar el examen →'; estado = 'Tienes un examen empezado. Continúa donde lo dejaste: el reloj no se ha parado.'; }
  else if (hecho) { estado = ultima && ultima.nota !== undefined
      ? 'Ya has entregado este examen. Tu nota: ' + String(ultima.nota).replace('.', ',') + ' sobre 10.'
      : 'Ya has entregado este examen. Tu nota la verás cuando tu profesor la publique.'; }
  else if (j.estado === 'pronto') estado = 'Todavía no está abierto. Se abre el ' + fmtFecha(j.desde) + '.';
  else if (j.estado === 'cerrado') estado = 'Este examen ya está cerrado.';
  else boton = 'Empezar el examen →';
  E.innerHTML =
    '<div class="portada">' +
      '<div class="sup">EXAMEN</div>' +
      '<h1>' + tituloBonito(info.titulo) + '</h1>' +
      '<ul class="reglas-examen">' +
        '<li>' + n + (n === 1 ? ' pregunta' : ' preguntas') + ' y ' + t + (t === 1 ? ' minuto' : ' minutos') + '. El reloj empieza al pulsar «Empezar» y no se para.</li>' +
        '<li><span>' + (nint === 1 ? 'Solo tienes un intento.' : 'Tienes ' + nint + ' intentos.') + (j ? textoIntentos(j, nint) : '') + '</span></li>' +
        '<li>No verás si aciertas: tu nota la verás cuando tu profesor la publique.</li>' +
        '<li>Puedes volver atrás y cambiar tus respuestas hasta que entregues.</li>' +
        '<li>Si sales de esta pestaña o de la aplicación, queda anotado.</li>' +
        '<li>Si se corta internet, tus respuestas se guardan solas al volver. No cierres la página.</li>' +
        '<li>Si recargas, escribes tu código y continúas donde estabas.</li>' +
      '</ul>' +
      (estado ? '<p class="aviso-examen" id="estadoExamen" role="status">' + esc(estado) + '</p>' : '') +
      (ultima ? '<p class="aviso-examen" id="estadoNota" role="status" hidden></p><div id="detalleNota"></div>' : '') +
      (mensaje ? '<p class="aviso-examen rojo" role="alert">' + esc(mensaje) + '</p>' : '') +
      '<div class="acciones">' +
        (boton ? '<button class="btn pri" id="bEmpezar">' + boton + '</button>' : '') +
        (ultima && ultima.id ? '<button class="btn' + (boton ? '' : ' pri') + '" id="bVerResultado">Ver mi resultado</button>' : '') +
        (!boton && j ? '<button class="btn" id="bActualizar">Volver a comprobar</button>' : '') +
        (!j ? '<button class="btn pri" id="bActualizar">Reintentar</button>' : '') +
        '<span class="quien">Entras como <b>nº ' + esc(ctx.alumno.alumno.split('-').pop()) + '</b> · <button class="enlace" id="bSalir">No soy yo</button></span>' +
      '</div>' +
    '</div>';
  if (boton) { $('#bEmpezar').onclick = empezar; $('#bEmpezar').focus(); }
  const act = $('#bActualizar'); if (act) act.onclick = () => portada();
  const ver = $('#bVerResultado'); if (ver) ver.onclick = () => comprobarNota(ultima.id, '#bVerResultado');
  $('#bSalir').onclick = () => ctx.salir();
}

/* ---------- empezar / reanudar ---------- */
async function empezar() {
  const b = $('#bEmpezar'); if (b) { b.disabled = true; b.textContent = 'Preparando tu examen…'; }
  let r;
  try { r = await llamar('empezar_partida', { p_asignacion: juego.asignacion }); }
  catch (e) { return pintarPortada(juego, 'No hay conexión con el servidor. Comprueba internet y vuelve a probar.'); }
  if (!r.ok) {
    const m = { aun_no: 'Todavía no está abierto.', cerrada: 'Este examen ya está cerrado.', sin_intentos: 'Ya no te quedan intentos.', espera: 'Demasiados intentos seguidos. Espera un minuto.',
                no_encontrada: 'Este examen no está asignado a tu grupo.', sin_preguntas: 'Este examen no tiene preguntas. Avisa a tu profesor.', codigo: 'No he podido comprobar tu código. Vuelve a entrar.' }[r.motivo];
    return portada(m || 'No he podido empezar el examen. Avisa a tu profesor.');
  }
  arrancar(r);
}

function arrancar(r) {
  partida = r; items = r.items; pos = 0;
  resp = {}; acumMs = {}; pendientes = new Map(); enVuelo = new Set(); salidas = 0; fueraDesde = null; focoDesde = null; focos = 0; sinRedDesde = null;
  for (const [clave, v] of Object.entries(r.respondidas || {})) resp[clave] = v;
  limiteLocal = Date.now() + r.restante_s * 1000;
  inicio = Date.now(); activo = true; entregando = false; acabado = false;
  if (!avisos) { avisos = document.createElement('div'); avisos.className = 'avisos-examen'; avisos.setAttribute('aria-live', 'polite'); E.parentNode.insertBefore(avisos, E); }
  avisos.innerHTML = '';
  barra.innerHTML = items.map(() => '<i></i>').join('');
  [...barra.children].forEach((el, i) => el.onclick = () => navegar(i));
  $('#bot').hidden = false; $('#reloj').hidden = false;
  $('#bAnt').onclick = () => navegar(pos - 1);
  $('#bSig').onclick = () => (pos < items.length - 1 ? navegar(pos + 1) : revisar());
  // Atajo para ir directo a «Revisar y entregar» desde cualquier pregunta (sin pasar por todas)
  if (!$('#bFin')) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'bFin'; b.textContent = 'Entregar'; b.title = 'Revisar y entregar'; $('#bot').insertBefore(b, $('#bSig')); }
  $('#bFin').onclick = () => { if (activo) { guardarPendienteDeLaVista(); revisar(); } };
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('blur', alPerderFoco);
  window.addEventListener('focus', alRecuperarFoco);
  document.addEventListener('keydown', teclado);
  window.addEventListener('beforeunload', antesDeCerrar);
  window.addEventListener('online', reintentarYa);
  window.addEventListener('offline', () => marcarRed(false));
  clearInterval(relojId); relojId = setInterval(tic, 500); tic();
  clearInterval(reintentoId); reintentoId = setInterval(reintentarYa, REINTENTO_MS);
  // ¿Venía de una recarga o de otro móvil? (ya había pasado tiempo o contestado cosas)
  if (Object.keys(resp).length || (r.restante_s < juego.tiempo_min * 60 - 15)) evento('recarga');
  const primera = items.findIndex(i => resp[i.clave] === undefined);
  ir(primera < 0 ? 0 : primera);
}

/* ---------- reloj ---------- */
function tic() {
  if (!activo) return;
  const s = Math.max(0, Math.ceil((limiteLocal - Date.now()) / 1000));
  const el = $('#reloj');
  el.textContent = fmtTiempo(s);
  el.className = 'reloj' + (s <= 60 ? ' muy-poco' : s <= 300 ? ' poco' : '');
  if (s <= 0) tiempoAgotado();
}
async function tiempoAgotado() {
  if (acabado || entregando) return;
  entregando = true; activo = false; clearInterval(relojId);
  E.innerHTML = '<div class="portada"><div class="sup">SE ACABÓ EL TIEMPO</div><p class="enun">Estoy entregando tu examen…</p></div>';
  $('#bot').hidden = true;
  await entregarFinal({ porTiempo: true });
}

/* ---------- pregunta ---------- */
function ir(i) {
  pos = Math.max(0, Math.min(items.length - 1, i));
  const it = items[pos];
  vista = renderizador(it.tipo).pintar(it, E, {
    examen: true, respuesta: resp[it.clave] !== undefined ? { dada: resp[it.clave] } : null,
    chipTipo: chipPorDefecto, hayChuleta: false, alVerChuleta() {},
    alResponder: v => responder(it, v)
  });
  t0 = Date.now();
  actualizarBarra();
  window.scrollTo({ top: 0 });
}
async function navegar(i) {
  if (!activo || i < 0) return;
  guardarPendienteDeLaVista();
  if (i >= items.length) return revisar();
  ir(i);
}
function guardarPendienteDeLaVista() {
  const txt = vista && vista.pendiente && vista.pendiente();
  if (txt) responder(items[pos], txt);
}
function actualizarBarra() {
  [...barra.children].forEach((el, i) => { el.className = (resp[items[i].clave] !== undefined ? 'hecha' : '') + (i === pos ? ' act' : ''); });
  $('#contador').textContent = (pos + 1) + '/' + items.length;
  $('#bAnt').disabled = pos === 0;
  $('#bSig').disabled = false;
  $('#bSig').textContent = pos === items.length - 1 ? 'Revisar y entregar →' : 'Siguiente →';
  $('#bFin').hidden = pos === items.length - 1;
  $('#pista').textContent = 'Contesta y sigue. Puedes volver atrás y cambiar lo que quieras hasta entregar.';
}

/* ---------- guardar respuestas (con reintentos) ---------- */
function responder(it, valor) {
  const ahora = Date.now();
  acumMs[it.clave] = (acumMs[it.clave] || 0) + (ahora - t0); t0 = ahora;
  resp[it.clave] = valor;
  pendientes.set(it.clave, { dada: valor, ms: Math.min(acumMs[it.clave], 3600000) });
  actualizarBarra();
  enviar(it.clave);
}
async function enviar(clave) {
  if (enVuelo.has(clave)) return;          // ya hay un envío de esta pregunta: al acabar mira si hay algo más nuevo
  enVuelo.add(clave);
  try {
    while (pendientes.has(clave)) {
      const p = pendientes.get(clave);
      let r;
      try { r = await llamar('responder', { p_partida: partida.partida, p_item: clave, p_dada: p.dada, p_ms: p.ms }); }
      catch (e) { marcarRed(false); return; }
      marcarRed(true);
      if (r.ok) { if (pendientes.get(clave) === p) pendientes.delete(clave); continue; }
      if (r.motivo === 'caducada' || r.motivo === 'entregada') { pendientes.clear(); return finPorServidor(r.motivo); }
      if (r.motivo === 'espera') return;                          // se reintenta solo
      console.error('responder rechazado:', r.motivo, clave); pendientes.delete(clave);      // dato/item/…: no se puede guardar, no insistir
    }
  } finally { enVuelo.delete(clave); }
}
function reintentarYa() { if (activo || entregando) for (const clave of pendientes.keys()) enviar(clave); }
function marcarRed(bien) {
  if (bien) {
    if (sinRedDesde) { const seg = Math.round((Date.now() - sinRedDesde) / 1000); sinRedDesde = null; quitarAviso('red'); evento('sin_red', { segundos: seg }); }
  } else if (!sinRedDesde) {
    sinRedDesde = Date.now();
    aviso('Sin conexión. Tus respuestas se guardarán solas en cuanto vuelva internet. No cierres esta página.', { rojo: true, id: 'red' });
  }
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
// Antes de entregar, que todo lo contestado esté en el servidor. Devuelve true si no queda nada pendiente.
async function vaciarPendientes(maximoMs = ESPERA_ENTREGA_MS) {
  guardarPendienteDeLaVista();
  const fin = Date.now() + maximoMs;
  while (pendientes.size && Date.now() < fin && !acabado) {
    for (const clave of [...pendientes.keys()]) enviar(clave);
    await esperar(400);
  }
  return pendientes.size === 0;
}

/* ---------- eventos: salidas de pestaña ---------- */
function evento(tipo, detalle) {
  if (!partida) return;
  const args = { p_partida: partida.partida, p_tipo: tipo, p_detalle: detalle || null };
  llamar('evento', args, { keepalive: true, reintentos: 2 }).catch(() => {});
}
function alCambiarVisibilidad() {
  if (!activo) return;
  if (document.visibilityState === 'hidden') { fueraDesde = Date.now(); salidas++; evento('salida'); }
  else if (fueraDesde) {
    const seg = Math.round((Date.now() - fueraDesde) / 1000); fueraDesde = null;
    evento('vuelta', { segundos: seg });
    aviso('Has salido de la página ' + (salidas === 1 ? 'una vez' : salidas + ' veces') + '. Queda anotado.', { id: 'salida', segundos: 12 });
  }
}
/* Foco perdido: la ventana del examen sigue VISIBLE pero el alumno ha pulsado en otra (dos ventanas a la vez).
   Se anota como «otro» con detalle.foco (no hace falta cambiar el SQL). Si lo que pasa es una salida de pestaña, ya la cuenta visibilitychange. */
const FOCO_MIN_MS = 1500;                       // un blur más corto (notificación del sistema, etc.) no se anota
function alPerderFoco() {
  if (!activo || focoDesde) return;
  const t0 = Date.now(); focoDesde = t0;
  setTimeout(() => {
    if (focoDesde !== t0) return;               // ya volvió antes de tiempo
    if (document.visibilityState === 'hidden' || fueraDesde) { focoDesde = null; return; }   // es una salida de pestaña: ya anotada
    focos++; focoDesde = -t0;                   // negativo = ya anotado
    evento('otro', { foco: 'perdido' });
    aviso('Has pulsado fuera de la ventana del examen. Queda anotado.', { id: 'foco', segundos: 12 });
  }, FOCO_MIN_MS);
}
function alRecuperarFoco() {
  if (!activo || !focoDesde) return;
  if (focoDesde < 0) { const seg = Math.round((Date.now() + focoDesde) / 1000); evento('otro', { foco: 'vuelto', segundos: seg }); }
  focoDesde = null;
}
function antesDeCerrar(e) { if (pendientes.size) { e.preventDefault(); e.returnValue = ''; } }

/* ---------- teclado ---------- */
function teclado(e) {
  if (!activo || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const ops = [...E.querySelectorAll('.op')], tipo = items[pos] && items[pos].tipo;
  if (tipo === 'opcion_multiple') { const k = '123456'.indexOf(e.key); if (k >= 0 && ops[k]) { ops[k].click(); return; } }
  if (tipo === 'verdadero_falso' && /^[vVfF]$/.test(e.key)) { const b = E.querySelector('.op[data-valor="' + (/^[vV]$/.test(e.key) ? 'true' : 'false') + '"]'); if (b) b.click(); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); $('#bSig').click(); }
  if (e.key === 'ArrowLeft' && pos > 0) { e.preventDefault(); navegar(pos - 1); }
}

/* ---------- revisar y entregar ---------- */
function revisar(confirmar = false) {
  guardarPendienteDeLaVista();
  const vacias = items.map((i, k) => [i, k]).filter(([i]) => resp[i.clave] === undefined);
  E.innerHTML =
    '<div class="portada final">' +
      '<div class="sup">ANTES DE ENTREGAR</div>' +
      '<h1>Has contestado ' + respondidas() + ' de ' + items.length + '</h1>' +
      (vacias.length ? '<p class="aviso-examen">Te faltan ' + vacias.length + (vacias.length === 1 ? ' pregunta' : ' preguntas') + ' (en amarillo). Pulsa una para ir a ella.</p>'
                     : '<p class="aviso-examen" style="color:var(--verde);border-color:rgba(63,207,134,.4);background:rgba(63,207,134,.12)">Has contestado todas. Revisa lo que quieras.</p>') +
      '<div class="rejilla">' + items.map((i, k) => '<button class="' + (resp[i.clave] === undefined ? 'vacia' : 'hecha') + '" data-i="' + k + '">' + (k + 1) + '</button>').join('') + '</div>' +
      (confirmar ? '<p class="aviso-examen rojo" role="alert">¿Seguro? Cuando entregues no podrás cambiar nada.</p>' : '') +
      '<div class="acciones">' +
        (confirmar ? '<button class="btn pri" id="bConfirmar">Sí, entregar ya</button><button class="btn" id="bVolver">No, seguir revisando</button>'
                   : '<button class="btn pri" id="bEntregar">Entregar el examen</button><button class="btn" id="bVolver">Volver al examen</button>') +
      '</div>' +
    '</div>';
  $('#bot').hidden = true; $('#contador').textContent = '';
  E.querySelectorAll('.rejilla button').forEach(b => b.onclick = () => { $('#bot').hidden = false; ir(+b.dataset.i); });
  $('#bVolver').onclick = () => { $('#bot').hidden = false; ir(Math.min(pos, items.length - 1)); };
  if (confirmar) $('#bConfirmar').onclick = entregar; else $('#bEntregar').onclick = () => revisar(true);
  window.scrollTo({ top: 0 });
}

async function entregar() {
  if (entregando) return;
  entregando = true;
  E.innerHTML = '<div class="portada"><div class="sup">ENTREGANDO</div><p class="enun" id="msgEntrega">Guardando tus respuestas…</p></div>';
  const ok = await vaciarPendientes();
  if (!ok) {
    entregando = false;
    E.innerHTML = '<div class="portada"><div class="sup">NO SE HA ENTREGADO</div><p class="enun">No he podido guardar ' + pendientes.size + (pendientes.size === 1 ? ' respuesta' : ' respuestas') +
      ' porque no hay conexión. Tu examen sigue abierto. Comprueba internet y vuelve a intentarlo.</p><div class="acciones"><button class="btn pri" id="bOtraVez">Reintentar</button><button class="btn" id="bVolver">Volver al examen</button></div></div>';
    $('#bOtraVez').onclick = entregar;
    $('#bVolver').onclick = () => { $('#bot').hidden = false; ir(pos); };
    return;
  }
  activo = false; clearInterval(relojId);
  await entregarFinal({});
}

// Llama a terminar_partida (con reintentos si no hay red) y enseña la pantalla de «entregado»
async function entregarFinal({ porTiempo = false }) {
  await vaciarPendientes(porTiempo ? 4000 : 1000).catch(() => {});
  for (let intento = 0; intento < 40 && !acabado; intento++) {
    try {
      const r = await llamar('terminar_partida', { p_partida: partida.partida });
      if (r.ok) return pantallaEntregado(porTiempo || r.estado === 'caducada');
      if (r.motivo === 'espera') { await esperar(2000); continue; }
      return pantallaEntregado(porTiempo);
    } catch (e) {
      E.innerHTML = '<div class="portada"><div class="sup">' + (porTiempo ? 'SE ACABÓ EL TIEMPO' : 'ENTREGANDO') + '</div><p class="enun">Sin conexión. Sigo intentando entregar tu examen… No cierres la página.</p></div>';
      await esperar(2500);
    }
  }
}
function finPorServidor(motivo) {
  if (acabado) return;
  activo = false; clearInterval(relojId);
  pantallaEntregado(motivo === 'caducada');
}

/* ---------- entregado y nota ---------- */
function limpiarSesion() {
  activo = false; entregando = false; clearInterval(relojId); clearInterval(reintentoId);
  document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  window.removeEventListener('blur', alPerderFoco);
  window.removeEventListener('focus', alRecuperarFoco);
  document.removeEventListener('keydown', teclado);
  window.removeEventListener('beforeunload', antesDeCerrar);
  window.removeEventListener('online', reintentarYa);
  $('#reloj').hidden = true; $('#bot').hidden = true;
}
function pantallaEntregado(porTiempo) {
  if (acabado) return;
  acabado = true; limpiarSesion();
  barra.innerHTML = items.map((i) => '<i class="' + (resp[i.clave] !== undefined ? 'hecha' : '') + '"></i>').join(''); $('#contador').textContent = '';
  E.innerHTML =
    '<div class="portada final">' +
      '<div class="sup">' + (porTiempo ? 'SE ACABÓ EL TIEMPO' : 'EXAMEN ENTREGADO') + '</div>' +
      '<h1>✓ Entregado</h1>' +
      '<p class="enun">Has contestado ' + respondidas() + ' de ' + items.length + ' preguntas.</p>' +
      '<p class="aviso-examen" id="estadoNota" role="status">Tu nota la verás cuando tu profesor la publique.</p>' +
      '<div id="detalleNota"></div>' +
      '<div class="acciones"><button class="btn pri" id="bNota">Comprobar si ya hay nota</button><button class="btn" id="bSalirFinal">Terminar y salir</button></div>' +
    '</div>';
  $('#bNota').onclick = comprobarNota;
  $('#bSalirFinal').onclick = () => ctx.salir();
  window.scrollTo({ top: 0 });
}
// Enseña la nota (y la revisión si el profesor la permite) de un intento ya entregado: desde la pantalla de «entregado» o desde la portada
async function comprobarNota(idIntento, idBoton) {
  const b = $(typeof idBoton === 'string' ? idBoton : '#bNota'), est = $('#estadoNota'), det = $('#detalleNota');
  est.hidden = false; b.disabled = true; est.textContent = 'Comprobando…';
  let r;
  try { r = await llamar('mi_resultado', { p_partida: typeof idIntento === 'string' ? idIntento : partida.partida }); }
  catch (e) { b.disabled = false; est.textContent = 'No hay conexión. Vuelve a probar.'; return; }
  b.disabled = false;
  if (!r.ok) { est.textContent = 'No he podido comprobarlo. Vuelve a probar.'; return; }
  if (!r.publicada || r.nota === undefined) { est.textContent = 'Todavía no está publicada. Vuelve a comprobarlo más tarde.'; return; }
  est.className = 'aviso-examen'; est.style.color = 'var(--verde)';
  est.textContent = 'Tu nota: ' + String(r.nota).replace('.', ',') + ' sobre 10 · ' + r.aciertos + ' de ' + r.total + ' bien';
  if (r.revision) {
    det.innerHTML = '<div class="subtit">REVISIÓN</div>' + r.revision.map((x, k) =>
      '<div class="caja ' + (x.ok ? 'porque' : 'trampa') + '"><b>' + (k + 1) + ' · ' + (x.ok ? 'BIEN' : x.respondida ? 'MAL' : 'EN BLANCO') + '</b>' + esc(x.enun) +
      '<br><small>Respuesta correcta: ' + esc(String(x.correcta)) + '</small><br><small>' + esc(x.sol) + '</small></div>').join('');
  }
}

/* ---------- el contrato de los modos ---------- */
export default {
  id: 'examen',
  nombre: 'Examen',
  necesita: { directo: false, servidor: true },
  tiposPregunta: TIPOS_JUGABLES,

  async iniciar(c) {
    ctx = c; E = c.contenedor; barra = $('#barra'); juego = c.juego; partida = null; items = []; resp = {}; acabado = false;
    await portada();
  },

  async terminar() {
    limpiarSesion();
    if (avisos) { avisos.remove(); avisos = null; }
    return {
      partida: partida ? partida.partida : null, alumno: ctx && ctx.alumno ? ctx.alumno.alumno : null, juego: juego ? juego.juego : null,
      nota: null, puntos: 0, segundos: inicio ? Math.round((Date.now() - inicio) / 1000) : 0, por_criterio: {},
      respuestas: items.filter(i => resp[i.clave] !== undefined).map(i => ({ id: i.clave, dada: resp[i.clave] }))
    };
  }
};
