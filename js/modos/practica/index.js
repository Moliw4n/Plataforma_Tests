/* Modo PRÁCTICA — el de siempre: preguntas de opción múltiple, corrección al momento con
   «por qué» y «la trampa», se puede repetir las veces que se quiera. Guarda cada intento. */
import { esc, barajar, tituloBonito } from '../../nucleo/util.js';
import { resultadoNormalizado } from '../../nucleo/modos.js';
import { pintar as pintarPregunta } from '../../nucleo/preguntas/opcion_multiple.js';

const $ = s => document.querySelector(s);
const NOMBRE_TIPO = { imprime: '¿Qué imprime?', error: 'Encuentra el error', hueco: 'Completa el hueco' };

/* ---------- estado (un solo modo activo a la vez) ---------- */
let ctx = null, T = null, E = null, barra = null;
let lista = [];          // preguntas de este intento: {p, orden:[índices de opciones]}
let pos = 0;
let resp = [];           // por posición: {id, elegida (índice original), ok, ms}
let t0 = 0, inicioIntento = 0;
let intento = null;      // lo último que se envió a guardar (formato de guardar_intento)
let vista = null;        // lo que devuelve el renderizador de la pregunta que se ve
let estadoGuardado = 'local';   // 'guardando' | 'ok' | 'error' | 'local' | 'profe'

// Etiqueta de tipo: usa los tipos del test si los trae ({tipos:{id:{nombre,color}}})
const chipTipo = t => { const d = T && T.tipos && T.tipos[t];
  return d ? '<span class="tipo" style="background:var(--' + d.color + ')">' + esc(d.nombre) + '</span>'
           : '<span class="tipo t-' + t + '">' + (NOMBRE_TIPO[t] || t) + '</span>'; };

/* ---------- portada ---------- */
function portada() {
  $('#bot').hidden = true; barra.innerHTML = ''; $('#contador').textContent = '';
  const n = T.preguntas.length;
  const tipos = [...new Set(T.preguntas.map(p => p.tipo))];
  const alumno = ctx.alumno;
  E.innerHTML =
    '<div class="portada">' +
      '<div class="sup">' + esc((T.materia || '') + (T.unidad ? ' · ' + T.unidad : '')).toUpperCase() + '</div>' +
      '<h1>' + tituloBonito(T.titulo) + '</h1>' +
      '<div class="reglas">' +
        '<div class="regla"><span class="g">' + n + '</span><p>preguntas de práctica</p></div>' +
        '<div class="regla"><span class="g">al momento</span><p>sabes si aciertas, y por qué</p></div>' +
        (T.chuleta ? '<div class="regla"><span class="g" style="color:var(--ambar)">chuleta</span><p>ábrela cuando quieras con el botón amarillo</p></div>' : '') +
        '<div class="regla"><span class="g">sin prisa</span><p>puedes repetirlo las veces que quieras</p></div>' +
      '</div>' +
      '<div class="leyenda">' + tipos.map(chipTipo).join('') + '</div>' +
      '<div class="acciones"><button class="btn pri" id="bEmpezar">Empezar →</button>' +
        (ctx.modoProfe ? '<a class="btn" href="panel.html">← Volver al panel</a>' : '') +
        (alumno ? '<span class="quien">Entras como <b>nº ' + esc(alumno.alumno.split('-').pop()) + '</b> · <button class="enlace" id="bSalir">No soy yo</button></span>' : '') +
      '</div>' +
    '</div>';
  $('#bEmpezar').onclick = () => empezar(T.preguntas);
  if (alumno) $('#bSalir').onclick = salir;
  $('#bEmpezar').focus();
}
function salir() { lista = []; ctx.salir(); }

/* ---------- intento ---------- */
function empezar(preguntas) {
  lista = preguntas.map(p => {
    const idx = p.ops.map((_, i) => i);
    const orden = p.fija_ultima ? barajar(idx.slice(0, -1)).concat(idx.length - 1) : barajar(idx);
    return { p, orden };
  });
  resp = new Array(lista.length).fill(null);
  pos = 0; inicioIntento = Date.now(); estadoGuardado = 'local';
  barra.innerHTML = lista.map(() => '<i></i>').join('');
  [...barra.children].forEach((el, i) => el.onclick = () => { if (resp[i]) ir(i); });
  $('#bot').hidden = false;
  ir(0);
}

function ir(i) {
  pos = i;
  const { p, orden } = lista[i];
  vista = pintarPregunta(p, E, {
    orden, respuesta: resp[i], chipTipo,
    hayChuleta: !!T.chuleta,
    alResponder: responder,
    alVerChuleta: tema => ctx.chuleta && ctx.chuleta.abrir(tema)
  });
  t0 = Date.now();
  actualizarBarra();
  window.scrollTo({ top: 0 });
}

function responder(oi) {
  if (resp[pos]) return;
  const p = lista[pos].p;
  resp[pos] = { id: p.id, elegida: oi, ok: oi === p.ok, ms: Date.now() - t0 };
  vista.mostrarCorreccion({ elegida: oi, ok: oi === p.ok });
  actualizarBarra();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  // llevar la vista a la explicación, sin que la tape la barra de abajo
  setTimeout(() => {
    // baja solo lo justo para que se vea entera la explicación (sin pasarse del «¡Correcto!»)
    const v = E.querySelector('.veredicto'), fin = E.querySelector('.der .solu'); if (!v || !fin) return;
    const altoTop = document.querySelector('.top').offsetHeight, altoBot = $('#bot').offsetHeight;
    const y = window.scrollY;
    const necesario = fin.getBoundingClientRect().bottom + y - (window.innerHeight - altoBot - 16);
    const tope = v.getBoundingClientRect().top + y - altoTop - 12;
    const destino = Math.max(0, Math.min(necesario, tope));
    if (destino > y) window.scrollTo({ top: destino, behavior: 'smooth' });
  }, 80);
  if (resp.every(Boolean)) terminarIntento();
}

function actualizarBarra() {
  [...barra.children].forEach((el, i) => { el.className = (resp[i] ? (resp[i].ok ? 'ok' : 'mal') : '') + (i === pos ? ' act' : ''); });
  $('#contador').textContent = (pos + 1) + '/' + lista.length;
  $('#bAnt').disabled = pos === 0;
  const ultima = pos === lista.length - 1, hecha = !!resp[pos];
  const bSig = $('#bSig');
  bSig.disabled = !hecha;
  bSig.textContent = ultima ? 'Ver mi nota →' : 'Siguiente →';
  $('#pista').textContent = hecha ? 'Lee la explicación y sigue (Intro)' : 'Pulsa una opción (o las teclas 1-4)';
}

function siguiente() {
  if (!resp[pos]) return;
  // siguiente sin responder; si no queda ninguna, al resumen
  for (let k = 1; k <= lista.length; k++) { const j = (pos + k) % lista.length; if (!resp[j]) return ir(j); }
  resumen();
}

function terminarIntento() {
  const aciertos = resp.filter(r => r.ok).length;
  intento = {
    test: T.id, version: T.version || 1,
    empezado: new Date(inicioIntento).toISOString(), terminado: new Date().toISOString(),
    segundos: Math.round((Date.now() - inicioIntento) / 1000),
    total: resp.length, aciertos, nota: Math.round(aciertos / resp.length * 100) / 10,
    respuestas: resp.map(r => ({ id: r.id, elegida: r.elegida, ok: r.ok, ms: r.ms }))
  };
  guardarIntento(intento);
}

/* ---------- guardado ---------- */
async function guardarIntento(datos) {
  window.ultimoIntento = datos;
  if (ctx.modoProfe) { estadoGuardado = 'profe'; pintarGuardado(); return; }
  if (!ctx.alumno) { estadoGuardado = 'local'; return; }
  estadoGuardado = 'guardando'; pintarGuardado();
  try {
    const r = await ctx.api.rpc('guardar_intento', { p_codigo: ctx.alumno.codigo, p_datos: datos });
    estadoGuardado = r.ok ? 'ok' : 'error';
  } catch (e) { estadoGuardado = 'error'; }
  pintarGuardado();
}
function pintarGuardado() {
  const el = $('#guardado'); if (!el) return;
  const txt = { guardando: '⏳ Guardando tu resultado…', ok: '✓ Resultado guardado. Tu profesor ya lo puede ver.',
                error: '✗ No se ha podido guardar el resultado.', local: '',
                profe: 'Modo profesor: este intento no se ha guardado.' }[estadoGuardado];
  el.className = 'guardado ' + estadoGuardado;
  el.innerHTML = esc(txt) + (estadoGuardado === 'error' ? ' <button class="btn" id="bReintentar">Reintentar</button>' : '');
  el.hidden = !txt;
  const b = $('#bReintentar'); if (b) b.onclick = () => guardarIntento(intento);
}

/* ---------- resumen final ---------- */
function resumen() {
  $('#bot').hidden = true;
  pos = -1; actualizarBarraFinal();
  const total = resp.length, aciertos = resp.filter(r => r.ok).length;
  const nota = Math.round(aciertos / total * 100) / 10;
  const color = nota >= 9 ? 'var(--verde)' : nota >= 7 ? 'var(--cian)' : nota >= 5 ? 'var(--ambar)' : 'var(--rojo)';
  const msg = nota >= 9 ? '¡Lo dominas!' : nota >= 7 ? 'Muy bien. Repasa las que has fallado.' : nota >= 5 ? 'Aprobado. Mira las rojas con calma.' : 'Toca repasar: abre la chuleta y repite las falladas.';
  const seg = Math.round((Date.now() - inicioIntento) / 1000);
  const C = 2 * Math.PI * 70;
  const porTipo = {};
  lista.forEach(({ p }, i) => { const t = porTipo[p.tipo] || (porTipo[p.tipo] = { n: 0, ok: 0 }); t.n++; if (resp[i].ok) t.ok++; });
  const falladas = lista.filter((_, i) => !resp[i].ok).map(x => x.p);
  E.innerHTML =
    '<div class="portada final">' +
      '<div class="sup">TU RESULTADO</div>' +
      '<div class="anillo-nota"><div class="cifra"><svg class="aro" viewBox="0 0 170 170"><circle class="fondo-aro" cx="85" cy="85" r="70"/><circle class="valor" id="aroValor" cx="85" cy="85" r="70" stroke="' + color + '" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/></svg>' +
      '<div class="num" style="color:' + color + '">' + String(nota).replace('.', ',') + '<small>SOBRE 10</small></div></div>' +
      '<div class="mensaje">' + msg + '<small>' + aciertos + ' de ' + total + ' bien · ' + Math.floor(seg / 60) + ' min ' + (seg % 60) + ' s</small></div></div>' +
      '<div class="guardado" id="guardado" hidden></div>' +
      '<div class="por-tipo">' + Object.keys(porTipo).map(t => { const x = porTipo[t]; return '<div class="fila"><div class="cab">' + chipTipo(t) + '<b>' + x.ok + '/' + x.n + '</b></div><div class="medidor"><i style="width:' + (x.ok / x.n * 100) + '%"></i></div></div>'; }).join('') + '</div>' +
      '<div class="subtit">PULSA UNA PREGUNTA PARA REVISARLA</div>' +
      '<div class="rejilla">' + resp.map((r, i) => '<button class="' + (r.ok ? 'ok' : 'mal') + '" data-i="' + i + '">' + (i + 1) + '</button>').join('') + '</div>' +
      '<div class="acciones">' +
        (falladas.length ? '<button class="btn pri" id="bFalladas">Repetir las ' + falladas.length + ' falladas</button>' : '') +
        '<button class="btn' + (falladas.length ? '' : ' pri') + '" id="bOtraVez">Repetir el test entero</button>' +
        (ctx.alumno ? '<button class="btn" id="bTerminar">Terminar y salir</button>' : '') +
      '</div>' +
    '</div>';
  pintarGuardado();
  requestAnimationFrame(() => requestAnimationFrame(() => { $('#aroValor').style.strokeDashoffset = C * (1 - aciertos / total); }));
  E.querySelectorAll('.rejilla button').forEach(b => b.onclick = () => { $('#bot').hidden = false; ir(+b.dataset.i); });
  if (falladas.length) $('#bFalladas').onclick = () => empezar(falladas);
  $('#bOtraVez').onclick = () => empezar(T.preguntas);
  if (ctx.alumno) $('#bTerminar').onclick = salir;
  window.scrollTo({ top: 0 });
}
function actualizarBarraFinal() {
  [...barra.children].forEach((el, i) => { el.className = resp[i] ? (resp[i].ok ? 'ok' : 'mal') : ''; });
  $('#contador').textContent = '';
}

/* ---------- teclado ---------- */
function teclado(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const chuleta = ctx.chuleta;
  if (chuleta && chuleta.abierta()) { if (e.key === 'Escape') chuleta.cerrar(); return; }
  if ((e.key === 'c' || e.key === 'C') && chuleta && chuleta.lista()) { chuleta.abrir(); return; }
  if (!lista.length || pos < 0 || $('#bot').hidden) return;
  const n = '1234'.indexOf(e.key);
  if (n >= 0 && !resp[pos] && lista[pos].orden[n] !== undefined) { responder(lista[pos].orden[n]); return; }
  if ((e.key === 'Enter' || e.key === 'ArrowRight') && resp[pos]) { e.preventDefault(); siguiente(); }
  if (e.key === 'ArrowLeft' && pos > 0) ir(pos - 1);
}

/* ---------- resultado normalizado (5.3 del plan) ---------- */
function resultado() {
  const total = lista.length;
  const hechas = resp.filter(Boolean);
  const aciertos = hechas.filter(r => r.ok).length;
  const por = {};   // por criterio: fracción de aciertos entre las preguntas que lo traen
  lista.forEach(({ p }, i) => { if (!p.criterio) return; const c = por[p.criterio] || (por[p.criterio] = { n: 0, ok: 0 }); c.n++; if (resp[i] && resp[i].ok) c.ok++; });
  const por_criterio = {};
  Object.keys(por).forEach(k => { por_criterio[k] = Math.round(por[k].ok / por[k].n * 100) / 100; });
  return resultadoNormalizado({
    alumno: ctx.alumno ? ctx.alumno.alumno : null,
    juego: ctx.juego ? ctx.juego.id : T.id,
    nota: total ? Math.round(aciertos / total * 100) / 10 : 0,
    segundos: inicioIntento ? Math.round((Date.now() - inicioIntento) / 1000) : 0,
    por_criterio,
    respuestas: hechas.map(r => ({ id: r.id, elegida: r.elegida, ok: r.ok, ms: r.ms }))
  });
}

export default {
  id: 'practica',
  nombre: 'Práctica',
  necesita: { directo: false, servidor: true },
  tiposPregunta: ['opcion_multiple'],

  async iniciar(c) {
    ctx = c; T = c.contenido; E = c.contenedor; barra = $('#barra');
    lista = []; resp = []; pos = 0; intento = null; vista = null; estadoGuardado = 'local';
    c.temaActual = () => lista[pos] && lista[pos].p.tema;   // para que la chuleta abra en el tema de la pregunta
    $('#bAnt').onclick = () => { if (pos > 0) ir(pos - 1); };
    $('#bSig').onclick = siguiente;
    document.addEventListener('keydown', teclado);
    portada();
  },

  async terminar() {
    document.removeEventListener('keydown', teclado);
    return resultado();
  }
};
