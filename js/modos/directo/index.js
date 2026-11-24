/* Modo DIRECTO (tipo Kahoot) — el alumno, desde el móvil. El profesor proyecta la pregunta y manda el ritmo; aquí solo se contesta.
   Todo lo decide el SERVIDOR (supabase/09_directo.sql): las preguntas (sin solución), el tiempo, la corrección y los puntos.
   Funciones: directo_unirse (entra en la sala y recibe un apodo), directo_estado (lo que toca ver ahora), directo_responder (contesta UNA vez).
   El móvil pregunta por el estado cada poco (sondeo): así no depende de nada más que de las funciones seguras de siempre.
   Pensado para fallar bien: si se cae internet el aviso lo dice y sigue intentándolo; la respuesta pendiente se reenvía sola mientras dure la pregunta;
   si recarga, entra otra vez con su código y vuelve a la misma pantalla, con su apodo y sus puntos. */
import { esc } from '../../nucleo/util.js';
import { renderizador } from '../../nucleo/preguntas/index.js';
import { chipPorDefecto } from '../../nucleo/preguntas/comun.js';

const $ = s => document.querySelector(s);
// Ajustes SOLO para las pruebas (window.KIRON_AJUSTES); en producción valen los de siempre
const AJUSTES = window.KIRON_AJUSTES || {};
const SONDEO_MS = AJUSTES.sondeoMs || 1500;                 // cada cuánto pregunta qué pasa en la sala
const SONDEO_PREGUNTA_MS = AJUSTES.sondeoPreguntaMs || 1000; // durante una pregunta, algo más a menudo (para ver pronto que se cierra)
const REINTENTO_RESP_MS = AJUSTES.reintentoRespMs || 1000;   // cada cuánto se reintenta una respuesta que no llegó
const LET = 'ABCDEF';

let ctx, E;
let sala = null, salaEscrita = false;   // sala = el código de 6 cifras; escrita = lo ha tecleado el alumno (enlace fijo) en vez de venir en el enlace
let sesion = null, apodo = '', titulo = '', total = 0, apodoLibre = false;
let activo = false, sondeoId = null, relojId = null, token = 0;   // token: invalida sondeos viejos si se sale o se vuelve a entrar
let clave = '';                    // «estado:pregunta»: qué pantalla se está enseñando, para no repintar lo mismo en cada sondeo
let limiteLocal = 0, tiempoS = 20; // instante (Date.now()) en que se cierra la pregunta, corregido con el reloj del servidor
let preguntas = {};                // número de pregunta → la pregunta que se vio (para enseñar «la correcta» sin pedirla otra vez)
let enviadas = {};                 // número de pregunta → 'enviando' | 'ok' | 'pendiente'
let ultimo = null;                 // último estado recibido
let sinRed = false;

const llamar = (fn, args, opciones) => ctx.api.rpc(fn, { p_codigo: ctx.alumno.codigo, ...args }, opciones);
const pad = n => String(n).padStart(2, '0');
const esperar = ms => new Promise(r => setTimeout(r, ms));
const puntosTxt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const ordinal = n => n + '.º';

/* ---------- pantallas sueltas ---------- */
function mensaje(texto, { reintentar = null, salir = true, sup = 'DIRECTO' } = {}) {
  parar();
  $('#bot').hidden = true; $('#reloj').hidden = true; $('#contador').textContent = '';
  E.innerHTML = '<div class="portada"><div class="sup">' + esc(sup) + '</div><p class="enun">' + esc(texto) + '</p><div class="acciones">' +
    (reintentar ? '<button class="btn pri" id="bReintentarDirecto">Reintentar</button>' : '') +
    (salir ? '<button class="btn" id="bSalirDirecto">No soy yo</button>' : '') + '</div></div>';
  if (reintentar) $('#bReintentarDirecto').onclick = reintentar;
  if (salir) $('#bSalirDirecto').onclick = () => ctx.salir();
}
function avisoRed(hay) {
  if (hay === sinRed) return;
  sinRed = hay;
  let el = $('#avisoRedDirecto');
  if (hay) {
    if (!el) { el = document.createElement('div'); el.id = 'avisoRedDirecto'; el.className = 'aviso-examen rojo'; el.setAttribute('role', 'alert'); E.parentNode.insertBefore(el, E); }
    el.textContent = 'Sin conexión. Sigo intentándolo… no cierres la página.';
  } else if (el) el.remove();
}

/* ---------- entrar en la sala ---------- */
// Con el enlace fijo (jugar.html?d) la sala no viene en el enlace: se pide aquí, con el código que proyecta el profesor
function pedirSala(msg) {
  parar(); sala = null;
  $('#bot').hidden = true; $('#reloj').hidden = true; $('#contador').textContent = '';
  E.innerHTML =
    '<div class="portada acceso"><div class="sup">DIRECTO</div><h1>¿En qué <span>sala</span> entras?</h1>' +
    '<form class="caja-codigo" id="fSalaCodigo" autocomplete="off">' +
      '<label for="iSala">Escribe el código de la sala</label>' +
      '<input id="iSala" class="orb" inputmode="numeric" spellcheck="false" maxlength="20" placeholder="123 456" aria-describedby="msgSalaCodigo">' +
      '<button class="btn pri" id="bSalaCodigo">Entrar →</button>' +
      '<p class="msg" id="msgSalaCodigo" role="status">' + esc(msg || 'Son 6 cifras y están en la pantalla del profesor.') + '</p>' +
    '</form><div class="acciones"><button class="btn" id="bSalirDirecto">No soy yo</button></div></div>';
  const inp = $('#iSala');
  inp.addEventListener('input', () => { const v = inp.value.replace(/\D/g, '').slice(0, 6); inp.value = v.length > 3 ? v.slice(0, 3) + ' ' + v.slice(3) : v; inp.classList.remove('mal'); });
  $('#fSalaCodigo').onsubmit = e => {
    e.preventDefault();
    const digitos = inp.value.replace(/\D/g, '');
    if (digitos.length !== 6) { $('#msgSalaCodigo').textContent = 'El código de la sala son 6 cifras, por ejemplo 123 456.'; inp.classList.add('mal'); inp.focus(); return; }
    sala = digitos; salaEscrita = true;
    unirse();
  };
  $('#bSalirDirecto').onclick = () => ctx.salir();
  inp.focus();
}

async function unirse() {
  E.innerHTML = '<div class="cargando">Entrando en la sala…</div>';
  let r;
  try { r = await llamar('directo_unirse', { p_sala: sala }, { reintentos: 1 }); }
  catch (e) { return mensaje('No hay conexión con el servidor. Comprueba internet y vuelve a probar.', { reintentar: unirse }); }
  if (!r.ok) {
    if (r.motivo === 'espera') return mensaje('Demasiados intentos seguidos. Espera un minuto y vuelve a probar.', { reintentar: unirse });
    if (r.motivo === 'sala') {
      const texto = 'Esa sala no existe, ya ha terminado o no es para tu grupo.';
      return salaEscrita ? pedirSala(texto + ' Revisa el código que hay en la pantalla.') : mensaje(texto + ' Revisa el enlace con tu profesor.');
    }
    if (r.motivo === 'expulsado') return mensaje('Tu profesor te ha sacado de esta sala.');
    return mensaje('No he podido comprobar tu código. Vuelve a entrar.');
  }
  sesion = r.sesion; apodo = r.apodo; titulo = r.titulo; total = r.total; apodoLibre = !!r.apodo_libre;
  activo = true; clave = ''; preguntas = {}; enviadas = {};
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('online', sondearYa);
  sondear(++token);
}
function parar() {
  activo = false; token++; clearTimeout(sondeoId); clearInterval(relojId);
  document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  window.removeEventListener('online', sondearYa);
  const av = $('#avisoRedDirecto'); if (av) av.remove(); sinRed = false;
}
function alCambiarVisibilidad() { if (!document.hidden) sondearYa(); }
function sondearYa() { if (activo) { clearTimeout(sondeoId); sondear(++token); } }

/* ---------- sondeo: ¿qué toca ver ahora? ---------- */
async function sondear(mio) {
  if (!activo || mio !== token) return;
  let r = null;
  try { r = await llamar('directo_estado', { p_sesion: sesion }); avisoRed(false); }
  catch (e) { avisoRed(true); }
  if (!activo || mio !== token) return;
  let siguiente = SONDEO_MS;
  if (r) {
    if (!r.ok) {
      if (r.motivo === 'no_participas') { activo = false; return unirse(); }        // la sala sigue, pero no estaba dentro: se vuelve a entrar sola
      if (r.motivo === 'espera') siguiente = 4000;
      else return mensaje(r.motivo === 'codigo' ? 'No he podido comprobar tu código. Vuelve a entrar.' : 'La sala ya no existe. Pídele a tu profesor que abra una nueva.');
    } else {
      ultimo = r;
      pintar(r);
      if (r.estado === 'terminada') return;                                         // ya no hay nada que preguntar
      siguiente = r.estado === 'pregunta' ? (r.lectura_ms > 0 ? Math.min(SONDEO_PREGUNTA_MS, r.lectura_ms + 150) : SONDEO_PREGUNTA_MS) : SONDEO_MS;     // en la pausa de lectura se mira justo cuando acaba
    }
  } else siguiente = 2000;
  sondeoId = setTimeout(() => sondear(mio), siguiente);
}

function pintar(r) {
  tiempoS = r.tiempo_s;
  if (r.estado === 'pregunta') limiteLocal = Date.now() + r.restante_ms;            // se corrige con el reloj del servidor en cada sondeo
  const k = (r.estado === 'pregunta' && r.lectura_ms > 0 ? 'lectura' : r.estado) + ':' + r.actual;
  if (r.estado === 'espera') return pintarEspera(r, k);
  if (r.estado === 'pregunta' && r.lectura_ms > 0) return pintarLectura(r, k);
  if (r.estado === 'pregunta') return pintarPregunta(r, k);
  if (r.estado === 'resultado') return pintarResultado(r, k);
  return pintarFinal(r, k);
}

function cabecera(r, extra = '') {
  return '<div class="directo-cab"><span class="apodo-chip" title="Tu apodo en esta sala">' + esc(r.apodo) + '</span>' +
    '<span class="puntos-chip"><b>' + puntosTxt(r.puntos) + '</b> pts</span>' + extra + '</div>';
}

/* ---------- espera ---------- */
function pintarEspera(r, k) {
  if (clave !== k) {
    clave = k; clearInterval(relojId);
    $('#bot').hidden = true; $('#reloj').hidden = true; $('#contador').textContent = '';
    E.innerHTML = '<div class="portada final directo-espera"><div class="sup">DIRECTO · ' + esc(titulo) + '</div>' +
      '<h1>¡Estás dentro!</h1><p class="enun">Tu apodo en esta partida es</p><div class="apodo-grande" id="apodoGrande">' + esc(r.apodo) + '</div>' +
      (apodoLibre ? '<form class="caja-codigo" id="fApodo" autocomplete="off"><label for="iApodo">¿Prefieres otro? Escríbelo (2 a 16 letras o cifras)</label>' +
        '<input id="iApodo" maxlength="16" spellcheck="false" placeholder="Tu apodo"><button class="btn" id="bApodo">Cambiar mi apodo</button>' +
        '<p class="msg" id="msgApodo" role="status">Nada de tu nombre real, por favor: se ve en la pantalla de la clase. Si no es adecuado, tu profesor puede sacarte de la sala.</p></form>' : '') +
      '<p class="aviso-examen" role="status"><span id="nPart"></span> Esperando a que tu profesor empiece…</p>' +
      '<div class="acciones"><button class="btn" id="bSalirDirecto">No soy yo</button></div></div>';
    $('#bSalirDirecto').onclick = () => ctx.salir();
    const f = $('#fApodo'); if (f) f.onsubmit = cambiarApodo;
  }
  $('#nPart').textContent = r.participantes + (r.participantes === 1 ? ' jugador. ' : ' jugadores. ');
}
const MOTIVOS_APODO = { dato: 'Usa de 2 a 16 caracteres, sin símbolos raros.', ocupado: 'Ese apodo ya lo tiene otra persona en la sala. Prueba con otro.', empezada: 'La partida ya ha empezado: ya no se puede cambiar.', no_libre: 'En esta sala no se puede cambiar el apodo.', espera: 'Demasiados intentos seguidos. Espera un momento.' };
async function cambiarApodo(e) {
  e.preventDefault();
  const inp = $('#iApodo'), msg = $('#msgApodo'), b = $('#bApodo');
  const nuevo = inp.value.trim();
  if (!nuevo) { msg.textContent = 'Escribe el apodo que quieres.'; return; }
  b.disabled = true;
  try {
    const r = await llamar('directo_apodo', { p_sesion: sesion, p_apodo: nuevo });
    if (r.ok) { apodo = r.apodo; if (ultimo) ultimo.apodo = r.apodo; $('#apodoGrande').textContent = r.apodo; inp.value = ''; msg.textContent = '¡Hecho! Ahora te llamas ' + r.apodo + '.'; }
    else msg.textContent = MOTIVOS_APODO[r.motivo] || 'No se ha podido cambiar. Prueba otra vez.';
  } catch (err) { msg.textContent = 'No hay conexión. Prueba otra vez.'; }
  b.disabled = false;
}

/* ---------- pregunta ---------- */
function pintarPregunta(r, k) {
  const n = r.actual;
  preguntas[n] = r.pregunta;
  if (clave === k) {                                    // la misma pregunta: solo cosas que cambian por dentro
    if (r.respondio && enviadas[n] === undefined) { enviadas[n] = 'ok'; pantallaEnviada(n); }
    return;
  }
  clave = k; clearInterval(relojId);
  $('#bot').hidden = true; $('#reloj').hidden = false; $('#contador').textContent = (n + 1) + '/' + r.total;
  if (r.respondio) { enviadas[n] = enviadas[n] || 'ok'; return pantallaEnviada(n); }   // recargó después de contestar
  E.innerHTML = cabecera(r, '<span class="barra-tiempo" aria-hidden="true"><i id="barraTiempo"></i></span>') + '<div id="dirPregunta"></div>';
  renderizador(r.pregunta.tipo).pintar(r.pregunta, $('#dirPregunta'), {
    examen: true, respuesta: null, chipTipo: chipPorDefecto, hayChuleta: false, alVerChuleta() {},
    alResponder: v => responder(n, v)
  });
  iniciarReloj();
  window.scrollTo({ top: 0 });
}
/* Pausa de lectura: sale el enunciado y todavía no las opciones; el tiempo de contestar empieza cuando salgan */
function pintarLectura(r, k) {
  if (clave === k) return;
  clave = k; clearInterval(relojId);
  const p = r.pregunta;
  $('#bot').hidden = true; $('#reloj').hidden = true; $('#contador').textContent = (r.actual + 1) + '/' + r.total;
  E.innerHTML = cabecera(r) + '<div class="portada final directo-lectura"><div class="sup">PREGUNTA ' + (r.actual + 1) + ' DE ' + r.total + '</div>' +
    '<h2 class="enun">' + esc(p.enun) + '</h2>' + (p.code ? '<pre class="codigo">' + esc(p.code) + '</pre>' : '') +
    '<p class="aviso-examen" role="status">Lee la pregunta… las opciones salen enseguida.</p></div>';
  window.scrollTo({ top: 0 });
}
function iniciarReloj() {
  const tic = () => {
    const ms = Math.min(Math.max(0, limiteLocal - Date.now()), tiempoS * 1000), s = Math.ceil(ms / 1000);
    const el = $('#reloj'); if (el) { el.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60); el.className = 'reloj' + (s <= 5 ? ' muy-poco' : s <= 10 ? ' poco' : ''); }
    const b = $('#barraTiempo'); if (b) b.style.width = Math.min(100, ms / (tiempoS * 10)) + '%';
  };
  tic(); relojId = setInterval(tic, 200);
}

async function responder(n, valor) {
  if (enviadas[n] !== undefined) return;
  enviadas[n] = 'enviando';
  pantallaEnviada(n);
  // Se reintenta mientras dure la pregunta (y un poco más): si se cae internet, la respuesta espera y sale sola
  while (activo && enviadas[n] !== 'ok') {
    let r;
    try { r = await llamar('directo_responder', { p_sesion: sesion, p_pregunta: n, p_dada: valor }); avisoRed(false); }
    catch (e) {
      avisoRed(true); enviadas[n] = 'pendiente'; textoEnvio(n);
      if (Date.now() > limiteLocal + 4000) return;                                  // ya no se puede: no se sigue intentando
      await esperar(REINTENTO_RESP_MS); continue;
    }
    if (r.ok || r.motivo === 'ya_respondida') { enviadas[n] = 'ok'; textoEnvio(n); break; }
    if (r.motivo === 'espera') { await esperar(REINTENTO_RESP_MS * 2); continue; }
    if (r.motivo === 'aun_no') { await esperar(300); continue; }                     // todavía en la pausa de lectura: se reintenta enseguida
    if (r.motivo === 'cerrada' || r.motivo === 'otra_pregunta') { enviadas[n] = 'tarde'; textoEnvio(n); break; }
    console.error('directo_responder rechazado:', r.motivo); enviadas[n] = 'tarde'; textoEnvio(n); break;
  }
}
const TEXTO_ENVIO = { enviando: 'Enviando…', ok: '✓ Respuesta enviada', pendiente: 'Sin conexión: tu respuesta se enviará en cuanto vuelva internet.', tarde: 'Llegó tarde: la pregunta ya se había cerrado.' };
function textoEnvio(n) { const el = $('#estadoEnvio'); if (el && clave === 'pregunta:' + n) { el.textContent = TEXTO_ENVIO[enviadas[n]] || ''; el.className = 'aviso-examen' + (enviadas[n] === 'pendiente' || enviadas[n] === 'tarde' ? ' rojo' : ''); } }
function pantallaEnviada(n) {
  clearInterval(relojId);
  E.innerHTML = cabecera(ultimo || { apodo, puntos: 0 }) +
    '<div class="portada final directo-espera"><div class="sup">PREGUNTA ' + (n + 1) + ' DE ' + total + '</div><h1>¡Contestada!</h1>' +
    '<p class="aviso-examen" id="estadoEnvio" role="status"></p><p class="enun">Espera a que se cierre la pregunta para ver si has acertado.</p></div>';
  textoEnvio(n);
  $('#reloj').hidden = false; limiteLocal = Math.max(limiteLocal, Date.now());
  iniciarReloj();
}

/* ---------- resultado de la pregunta ---------- */
function textoCorrecta(r) {
  const c = r.resultado.correcta, p = preguntas[r.actual];
  if (typeof c === 'boolean') return c ? 'Verdadero' : 'Falso';
  const letra = LET[c] || '?';
  return p && p.ops && p.ops[c] !== undefined ? letra + ' · ' + p.ops[c] : 'la opción ' + letra;
}
function pintarResultado(r, k) {
  if (clave === k) return;
  clave = k; clearInterval(relojId);
  $('#bot').hidden = true; $('#reloj').hidden = true; $('#contador').textContent = (r.actual + 1) + '/' + r.total;
  const x = r.resultado, cual = !x.respondio ? 'nada' : x.ok ? 'ok' : 'mal';
  const titulo1 = { ok: '✓ ¡Correcto!', mal: '✗ Fallaste', nada: '⏱ No contestaste' }[cual];
  E.innerHTML = cabecera(r) +
    '<div class="portada final directo-res"><div class="sup">PREGUNTA ' + (r.actual + 1) + ' DE ' + r.total + '</div>' +
    '<h1 class="res-' + cual + '">' + titulo1 + '</h1>' +
    (x.ok ? '<p class="mas-puntos">+' + puntosTxt(x.puntos) + ' puntos</p>' : '') +
    '<div class="caja porque"><b>LA CORRECTA</b>' + esc(textoCorrecta(r)) + (x.sol ? '<br><small>' + esc(x.sol) + '</small>' : '') + '</div>' +
    '<p class="posicion">Vas <b>' + ordinal(r.posicion) + '</b> de ' + r.participantes + ' · ' + puntosTxt(r.puntos) + ' puntos</p>' +
    marcadorHtml(r.marcador) +
    '<p class="aviso-examen" role="status">Esperando la siguiente pregunta…</p></div>';
  window.scrollTo({ top: 0 });
}
function marcadorHtml(m) {
  return '<ol class="marcador">' + (m || []).map((p, i) => '<li class="' + (p.yo ? 'yo' : '') + '"><span class="n">' + (i + 1) + '</span><span class="ap">' + esc(p.apodo) + (p.yo ? ' (tú)' : '') +
    '</span><span class="pt">' + puntosTxt(p.puntos) + '</span></li>').join('') + '</ol>';
}

/* ---------- final ---------- */
function pintarFinal(r, k) {
  if (clave === k) return;
  clave = k; clearInterval(relojId); activo = false; clearTimeout(sondeoId);
  document.removeEventListener('visibilitychange', alCambiarVisibilidad); window.removeEventListener('online', sondearYa);
  $('#bot').hidden = true; $('#reloj').hidden = true; $('#contador').textContent = '';
  E.innerHTML = '<div class="portada final directo-res"><div class="sup">DIRECTO · ' + esc(titulo) + '</div><h1>¡Se acabó!</h1>' +
    '<p class="posicion">Has quedado <b>' + ordinal(r.posicion) + '</b> de ' + r.participantes + ' con <b>' + puntosTxt(r.puntos) + '</b> puntos</p>' +
    '<p class="enun">Acertaste ' + r.aciertos + ' de ' + r.total + ' preguntas.</p>' +
    '<div class="subtit">EL PODIO</div>' + marcadorHtml(r.marcador) +
    '<div class="acciones"><button class="btn pri" id="bSalirDirecto">Terminar y salir</button></div></div>';
  $('#bSalirDirecto').onclick = () => ctx.salir();
  window.scrollTo({ top: 0 });
}

/* ---------- el contrato de los modos ---------- */
export default {
  id: 'directo',
  nombre: 'Directo',
  necesita: { directo: true, servidor: true },
  tiposPregunta: ['opcion_multiple', 'verdadero_falso'],

  async iniciar(c) {
    ctx = c; E = c.contenedor; sesion = null; apodo = ''; ultimo = null; sinRed = false;
    sala = c.sala || null; salaEscrita = !sala;
    $('#bot').hidden = true;
    if (sala) await unirse(); else pedirSala();
  },

  async terminar() {
    const pts = ultimo ? ultimo.puntos : 0, alumno = ctx && ctx.alumno ? ctx.alumno.alumno : null;
    parar();
    $('#reloj').hidden = true; $('#bot').hidden = true;
    return { partida: sesion, alumno, juego: null, nota: null, puntos: pts, segundos: 0, por_criterio: {}, respuestas: [] };
  }
};
