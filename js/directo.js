/* Directo · pantalla del PROFESOR y del PROYECTOR (tipo Kahoot).
   Entras con tu cuenta (la misma que el panel), abres una sala y proyectas esta página: el código para que se unan, cada pregunta con su cuenta atrás,
   el reparto de respuestas con la correcta, el marcador y el podio. Todo lo manda el servidor (supabase/09_directo.sql): aquí solo se muestra
   y se pulsa «Siguiente». Cada segundo se pregunta cómo va la sala (sondeo). En pantalla solo salen APODOS; los números de alumno están ocultos
   hasta que pulses «Ver quién es quién». */
import { esc } from './nucleo/util.js';
import { conLineas } from './nucleo/codigo.js';
import { crearSesionProfe } from './nucleo/sesion-profe.js';

(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const CFG = window.CONFIG;
  const app = $('#app');
  // Ajustes SOLO para las pruebas (window.KIRON_AJUSTES)
  const AJUSTES = window.KIRON_AJUSTES || {};
  const SONDEO_MS = AJUSTES.sondeoProfeMs || 1000;
  const LET = 'ABCDEF';
  const CLAVE_SALA = 'pt_directo_sesion';
  const recuerda = { get() { try { return localStorage.getItem(CLAVE_SALA); } catch (e) { return null; } }, set(v) { try { v ? localStorage.setItem(CLAVE_SALA, v) : localStorage.removeItem(CLAVE_SALA); } catch (e) {} } };
  const pad = n => String(n).padStart(2, '0');
  const miles = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const codigoBonito = c => String(c).replace(/^(\d{3})(\d{3})$/, '$1 $2');

  let S = null;                     // la sesión del profesor
  let sala = null, est = null;      // la sala abierta y su último estado
  let clave = '', sondeoId = null, relojId = null, token = 0, sinRed = false, limiteLocal = 0, mostrarIds = false, ocupado = false;

  /* ---------- arranque y login ---------- */
  if (!CFG) { app.innerHTML = '<div class="cargando">No hay conexión con el servidor.</div>'; return; }
  S = crearSesionProfe(CFG, { alCaducar: msg => login(msg) });

  function login(msg) {
    parar(); $('#usuario').hidden = true; $('#bPantalla').hidden = true;
    S.pantallaLogin(app, msg, () => arrancar());
  }
  function arrancar() {
    const ses = S.sesion();
    $('#usuario').hidden = false;
    $('#usuario').innerHTML = esc(ses.email) + ' <button class="btn" id="bSalir">Salir</button>';
    $('#bSalir').onclick = () => { recuerda.set(null); S.salir(); login('Has salido.'); };
    $('#bPantalla').hidden = !document.documentElement.requestFullscreen;
    $('#bPantalla').onclick = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (e) {} };
    const guardada = recuerda.get();
    if (guardada) abrirSala(guardada, true); else inicio();
  }
  function parar() {
    token++; clearTimeout(sondeoId); clearInterval(relojId); clave = ''; est = null; sinRed = false;
    document.removeEventListener('keydown', teclas);
  }

  const errorLegible = e => {
    const d = String((e && e.detalle) || '');
    if (e && e.status === 404 && /function|schema cache|PGRST20/i.test(d)) return 'Falta instalar el SQL 09_directo.sql en Supabase.';
    const m = d.match(/directo_no_valido: (.*)$/);
    if (m) return m[1][0].toUpperCase() + m[1].slice(1) + '.';
    if (/no_autorizado/.test(d)) return 'Esta cuenta no es de profesor.';
    return 'No se ha podido: ' + (d || (e && e.message) || 'error desconocido');
  };

  /* ---------- inicio: salas abiertas y crear una nueva ---------- */
  async function inicio(mensaje) {
    parar(); recuerda.set(null); sala = null;
    $('#bPantalla').hidden = true;
    const mia = ++token;
    app.innerHTML = '<div class="cargando">Cargando…</div>';
    let activas = [], grupos = [], bancos = [], items = [];
    try {
      [grupos, bancos, items] = await Promise.all([S.api('grupos?select=id,nombre&order=id'), S.api('bancos?select=id,titulo,materia,unidad&order=id'), S.api('items?select=banco,tipo&limit=20000')]);
      activas = (await S.rpc('profe_directo_activas')).salas || [];
    } catch (e) {
      if (String(e.message) === '401') return;
      if (mia !== token) return;
      app.innerHTML = '<div class="aviso-examen rojo" role="alert">' + esc(errorLegible(e)) + '</div><div class="acciones"><button class="btn pri" id="bRecargar">Reintentar</button></div>';
      $('#bRecargar').onclick = () => inicio(); return;
    }
    if (mia !== token) return;
    const jugables = {};
    for (const i of items) if (i.tipo === 'opcion_multiple' || i.tipo === 'verdadero_falso') jugables[i.banco] = (jugables[i.banco] || 0) + 1;
    const utiles = bancos.filter(b => jugables[b.id]);
    app.innerHTML =
      (mensaje ? '<div class="aviso-examen" role="status">' + esc(mensaje) + '</div>' : '') +
      (activas.length ? '<section class="caja-directo"><h2>Salas abiertas</h2>' + activas.map(a =>
        '<div class="sala-abierta"><div><b>' + esc(a.titulo) + '</b> · ' + esc(a.grupo) + '<br><small>Código ' + codigoBonito(a.sala) + ' · ' + esc(a.estado) + ' · ' + a.participantes + ' jugadores</small></div>' +
        '<button class="btn pri" data-abrir="' + esc(a.sesion) + '">Abrir</button><button class="btn peligro" data-cerrar="' + esc(a.sesion) + '">Cerrar</button></div>').join('') + '</section>' : '') +
      '<section class="caja-directo"><h2>Nueva sala</h2>' +
      (utiles.length ? '<form id="fSala" class="form-sala" novalidate>' +
        '<div class="campo"><label for="sGrupo">GRUPO</label><select id="sGrupo">' + grupos.map(g => '<option value="' + esc(g.id) + '">' + esc(g.id) + ' · ' + esc(g.nombre) + '</option>').join('') + '</select></div>' +
        '<fieldset class="campo bancos-sala"><legend>BANCOS</legend>' + utiles.map(b =>
          '<label class="check"><input type="checkbox" name="banco" value="' + esc(b.id) + '"> <span>' + esc(b.titulo) + ' <small>(' + jugables[b.id] + ' preguntas jugables)</small></span></label>').join('') + '</fieldset>' +
        '<div class="fila-campos"><div class="campo"><label for="sPreg">PREGUNTAS</label><input id="sPreg" type="number" min="1" max="50" value="10"></div>' +
        '<div class="campo"><label for="sSeg">SEGUNDOS POR PREGUNTA</label><input id="sSeg" type="number" min="5" max="120" value="20"></div></div>' +
        '<div class="campo"><label for="sTit">TÍTULO (opcional)</label><input id="sTit" type="text" maxlength="80" placeholder="Repaso de la unidad 1"></div>' +
        '<label class="check"><input type="checkbox" id="sTema" checked> <span>Repartir las preguntas por temas</span></label>' +
        '<button class="btn pri" id="bAbrirSala" style="justify-content:center;padding:14px">Abrir sala →</button><p class="msg-error" id="msgSala" role="status"></p></form>'
        : '<p class="dato-p">Aún no hay bancos con preguntas de opción múltiple o verdadero/falso. Súbelos desde el panel (Exámenes → Bancos).</p>') +
      '</section>';
    app.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => abrirSala(b.dataset.abrir));
    app.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = async () => {
      if (!await confirmar('¿Cerrar esta sala? Los alumnos que estén dentro verán el final.', 'Cerrar la sala')) return;
      try { await S.rpc('profe_directo_terminar', { p_sesion: b.dataset.cerrar }); inicio(); } catch (e) { alert(errorLegible(e)); }
    });
    const f = $('#fSala');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const bs = [...f.querySelectorAll('[name=banco]:checked')].map(x => x.value), msg = $('#msgSala');
      const total = bs.reduce((s, id) => s + (jugables[id] || 0), 0), n = Number($('#sPreg').value), seg = Number($('#sSeg').value);
      if (!bs.length) { msg.textContent = 'Elige al menos un banco.'; return; }
      if (!Number.isInteger(n) || n < 1 || n > 50) { msg.textContent = 'Las preguntas deben ser un número de 1 a 50.'; return; }
      if (n > total) { msg.textContent = 'Los bancos elegidos solo tienen ' + total + ' preguntas jugables.'; return; }
      if (!Number.isInteger(seg) || seg < 5 || seg > 120) { msg.textContent = 'Los segundos deben ser de 5 a 120.'; return; }
      $('#bAbrirSala').disabled = true; msg.textContent = '';
      const datos = { grupo: $('#sGrupo').value, bancos: bs, preguntas: n, tiempo_s: seg, equilibrar: $('#sTema').checked ? 'tema' : 'ninguno' };
      if ($('#sTit').value.trim()) datos.titulo = $('#sTit').value.trim();
      try { const r = await S.rpc('profe_directo_crear', { p_datos: datos }); abrirSala(r.sesion); }
      catch (err) { if (String(err.message) === '401') return; msg.textContent = errorLegible(err); $('#bAbrirSala').disabled = false; }
    };
  }

  function confirmar(texto, boton) {
    return new Promise(res => {
      $('#dlgTexto').textContent = texto; $('#dlgSi').textContent = boton; $('#dialogo').hidden = false;
      const fin = v => { $('#dialogo').hidden = true; res(v); };
      $('#dlgSi').onclick = () => fin(true); $('#dlgNo').onclick = () => fin(false);
    });
  }

  /* ---------- la sala ---------- */
  async function abrirSala(id, alRecargar = false) {
    parar(); sala = id; recuerda.set(id); mostrarIds = false;
    $('#bPantalla').hidden = !document.documentElement.requestFullscreen;
    app.innerHTML = '<div class="cargando">Abriendo la sala…</div>';
    document.addEventListener('keydown', teclas);
    sondear(++token, alRecargar);
  }
  async function sondear(mio, primera = false) {
    if (mio !== token) return;
    let r = null;
    try { r = await S.rpc('profe_directo_estado', { p_sesion: sala }); avisoRed(false); }
    catch (e) {
      if (String(e.message) === '401') return;
      if (primera) { return inicio(errorLegible(e)); }
      avisoRed(true);
    }
    if (mio !== token) return;
    if (r) {
      if (!r.ok) return inicio('Esa sala ya no existe.');
      est = r; pintar(r);
    }
    sondeoId = setTimeout(() => sondear(mio), SONDEO_MS);
  }
  function avisoRed(hay) {
    if (hay === sinRed) return;
    sinRed = hay;
    let el = $('#avisoRedDirecto');
    if (hay) { if (!el) { el = document.createElement('div'); el.id = 'avisoRedDirecto'; el.className = 'aviso-examen rojo'; el.setAttribute('role', 'alert'); app.parentNode.insertBefore(el, app); } el.textContent = 'Sin conexión con el servidor. Sigo intentándolo…'; }
    else if (el) el.remove();
  }

  const ENLACE = () => new URL('jugar.html?d=' + est.sala + (window.ENTORNO === 'pruebas' ? '&entorno=pruebas' : ''), location.href).href;     // con el código de la sala dentro
  const ENLACE_FIJO = () => new URL('jugar.html?d' + (window.ENTORNO === 'pruebas' ? '&entorno=pruebas' : ''), location.href).href;                   // el mismo siempre: el alumno escribe el código
  function cabSala(r) {
    return '<div class="sala-cab"><span class="chip-sala">Sala <b>' + codigoBonito(r.sala) + '</b></span><span>' + esc(r.titulo) + '</span><span class="dato-p">' + esc(r.grupo) + ' · <span id="nJug">' + r.participantes.length + '</span> jugadores</span></div>';
  }
  function pintar(r) {
    if (r.estado === 'pregunta') limiteLocal = Date.now() + r.restante_ms;
    const k = r.estado + ':' + r.actual + ':' + (mostrarIds ? 'ids' : '');
    if (r.estado === 'espera') return pintarEspera(r, k);
    if (r.estado === 'pregunta') return pintarPregunta(r, k);
    if (r.estado === 'resultado') return pintarResultado(r, k);
    return pintarFinal(r, k);
  }
  const controles = html => '<div class="controles-directo">' + html + '</div>';
  const chipsJugadores = r => r.participantes.length ? r.participantes.map(p =>
    '<span class="chip-jug' + (p.conectado ? '' : ' fuera') + '">' + esc(p.apodo) + (mostrarIds ? ' <small>' + esc(p.alumno) + '</small>' : '') + '</span>').join('') : '<span class="dato-p">Aún no ha entrado nadie…</span>';

  /* ---------- espera: el código para unirse ---------- */
  function pintarEspera(r, k) {
    if (clave !== k) {
      clave = k; clearInterval(relojId);
      app.innerHTML = cabSala(r) +
        '<div class="espera-directo"><div class="sup">ÚNETE DESDE TU ORDENADOR O MÓVIL</div>' +
        '<div class="enlace-sala" id="enlaceFijo">' + esc(ENLACE_FIJO()) + '</div><p class="dato-p">Escribe tu código de alumno y, cuando te lo pida, el código de la sala:</p>' +
        '<div class="codigo-sala" id="codigoSala">' + codigoBonito(r.sala) + '</div>' +
        '<p class="dato-p">o entra directo con este enlace: <span class="enlace-chico" id="enlaceSala">' + esc(ENLACE()) + '</span></p>' +
        '<div class="acciones"><button class="btn" id="bCopiar">Copiar el enlace con el código</button><button class="btn" id="bIds">' + (mostrarIds ? 'Ocultar quién es quién' : 'Ver quién es quién') + '</button></div>' +
        '<div class="chips-jugadores" id="chips"></div></div>' +
        controles('<button class="btn pri grande" id="bAvanzar">Empezar ▶</button><button class="btn peligro" id="bCerrarSala">Cerrar sala</button>');
      enlazarComunes();
      $('#bCopiar').onclick = async () => { try { await navigator.clipboard.writeText(ENLACE()); $('#bCopiar').textContent = '¡Copiado!'; } catch (e) { $('#bCopiar').textContent = 'Cópialo a mano'; } };
    }
    $('#chips').innerHTML = chipsJugadores(r);
    $('#nJug').textContent = r.participantes.length;
  }

  /* ---------- pregunta y resultado: lo que se proyecta ---------- */
  function opcionesDe(p) {
    if (p.tipo === 'verdadero_falso') return ['Verdadero', 'Falso'];
    return p.ops || [];
  }
  function bloqueOpciones(p, resultado) {
    const ops = opcionesDe(p), total = resultado ? resultado.reparto.reduce((s, x) => s + x.veces, 0) : 0;
    return '<div class="opciones-directo' + (ops.length === 2 ? ' dos' : '') + '">' + ops.map((t, i) => {
      const x = resultado ? resultado.reparto[i] : null;
      const cls = 'op-d op-' + i + (x ? (x.correcta ? ' correcta' : ' dim') : '');
      return '<div class="' + cls + '" data-i="' + i + '"><span class="l">' + (p.tipo === 'verdadero_falso' ? (i === 0 ? 'V' : 'F') : LET[i]) + '</span><span class="tx">' + esc(t) + '</span>' +
        (x ? '<span class="veces"><i style="width:' + (total ? Math.round(x.veces / total * 100) : 0) + '%"></i><b>' + x.veces + '</b></span><span class="marca-d">' + (x.correcta ? '✓' : '') + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function preguntaHtml(r) {
    const p = r.pregunta;
    return '<h2 class="enun-directo">' + esc(p.enun) + '</h2>' + (p.code ? '<pre class="codigo codigo-directo">' + conLineas(p.code) + '</pre>' : '');
  }
  function pintarPregunta(r, k) {
    if (clave !== k) {
      clave = k; clearInterval(relojId);
      app.innerHTML = cabSala(r) +
        '<div class="proyector-q"><div class="meta-q"><span>PREGUNTA ' + (r.actual + 1) + ' DE ' + r.total + '</span><span id="contestadas"></span></div>' +
        '<div class="tiempo-directo"><span class="tiempo-grande" id="tiempoGrande"></span><span class="barra-tiempo grande" aria-hidden="true"><i id="barraGrande"></i></span></div>' +
        preguntaHtml(r) + bloqueOpciones(r.pregunta, null) + '</div>' +
        controles('<button class="btn pri grande" id="bAvanzar">Cerrar la pregunta ■</button><button class="btn peligro" id="bCerrarSala">Cerrar sala</button>');
      enlazarComunes();
      const tic = () => {
        const ms = Math.max(0, limiteLocal - Date.now()), s = Math.ceil(ms / 1000);
        const g = $('#tiempoGrande'); if (g) { g.textContent = s; g.className = 'tiempo-grande' + (s <= 5 ? ' ultimos' : ''); }
        const b = $('#barraGrande'); if (b) b.style.width = Math.min(100, ms / (r.tiempo_s * 10)) + '%';
      };
      tic(); relojId = setInterval(tic, 200);
    }
    $('#contestadas').textContent = r.respondidas + ' de ' + r.participantes.length + ' han contestado';
    $('#nJug').textContent = r.participantes.length;
  }
  function pintarResultado(r, k) {
    if (clave === k) { const nj = $('#nJug'); if (nj) nj.textContent = r.participantes.length; return; }
    clave = k; clearInterval(relojId);
    const ultima = r.actual + 1 >= r.total, x = r.resultado;
    const q = r.pregunta || null;                       // el servidor la manda también en el resultado (sin solución: la solución va en `resultado`)
    app.innerHTML = cabSala(r) +
      '<div class="proyector-q"><div class="meta-q"><span>RESULTADO · PREGUNTA ' + (r.actual + 1) + ' DE ' + r.total + '</span><span>' + r.respondidas + ' de ' + r.participantes.length + ' contestaron</span></div>' +
      (q ? '<h2 class="enun-directo">' + esc(q.enun) + '</h2>' + (q.code ? '<pre class="codigo codigo-directo">' + conLineas(q.code) + '</pre>' : '') + bloqueOpciones(q, x)
         : '<h2 class="enun-directo">Respuesta correcta: ' + esc(x.reparto.filter(z => z.correcta).map(z => z.texto).join(', ')) + '</h2>' + bloqueOpciones({ tipo: x.reparto.length === 2 && x.reparto[0].texto === 'Verdadero' ? 'verdadero_falso' : 'opcion_multiple', ops: x.reparto.map(z => z.texto) }, x)) +
      (x.sol ? '<div class="caja porque"><b>POR QUÉ</b>' + esc(x.sol) + '</div>' : '') + (x.trampa ? '<div class="caja trampa"><b>LA TRAMPA</b>' + esc(x.trampa) + '</div>' : '') +
      '<div class="subtit">MARCADOR</div>' + marcador(r, 5) + '</div>' +
      controles('<button class="btn pri grande" id="bAvanzar">' + (ultima ? 'Ver el final ▶' : 'Siguiente pregunta ▶') + '</button><button class="btn peligro" id="bCerrarSala">Cerrar sala</button>');
    enlazarComunes();
    window.scrollTo({ top: 0 });
  }
  function marcador(r, max) {
    return '<ol class="marcador grande">' + r.participantes.slice(0, max).map((p, i) =>
      '<li><span class="n">' + (i + 1) + '</span><span class="ap">' + esc(p.apodo) + (mostrarIds ? ' <small>' + esc(p.alumno) + '</small>' : '') + '</span><span class="pt">' + miles(p.puntos) + '</span></li>').join('') + '</ol>';
  }

  /* ---------- final: el podio ---------- */
  function pintarFinal(r, k) {
    if (clave === k) return;
    clave = k; clearInterval(relojId);
    const top = r.participantes.slice(0, 3), resto = r.participantes.slice(3);
    const medalla = ['🥇', '🥈', '🥉'];
    app.innerHTML = cabSala(r) +
      '<div class="final-directo"><div class="sup">¡SE ACABÓ!</div><h1>El podio</h1>' +
      '<div class="podio">' + top.map((p, i) => '<div class="puesto puesto-' + (i + 1) + '"><span class="medalla">' + medalla[i] + '</span><b>' + esc(p.apodo) + '</b>' +
        (mostrarIds ? '<small>' + esc(p.alumno) + '</small>' : '') + '<span class="pt">' + miles(p.puntos) + ' pts</span><small>' + p.aciertos + ' de ' + r.total + ' bien</small></div>').join('') + '</div>' +
      (resto.length ? '<ol class="marcador grande" start="4">' + resto.map((p, i) => '<li><span class="n">' + (i + 4) + '</span><span class="ap">' + esc(p.apodo) + (mostrarIds ? ' <small>' + esc(p.alumno) + '</small>' : '') +
        '</span><span class="pt">' + miles(p.puntos) + '</span></li>').join('') + '</ol>' : '') +
      '<div class="acciones"><button class="btn" id="bIds">' + (mostrarIds ? 'Ocultar quién es quién' : 'Ver quién es quién') + '</button></div></div>' +
      controles('<button class="btn pri grande" id="bNueva">Nueva sala</button>');
    $('#bIds').onclick = () => { mostrarIds = !mostrarIds; clave = ''; pintar(est); };
    $('#bNueva').onclick = () => inicio();
    window.scrollTo({ top: 0 });
  }

  /* ---------- acciones ---------- */
  function enlazarComunes() {
    const a = $('#bAvanzar'); if (a) a.onclick = avanzar;
    const c = $('#bCerrarSala'); if (c) c.onclick = cerrarSala;
    const i = $('#bIds'); if (i) i.onclick = () => { mostrarIds = !mostrarIds; clave = ''; pintar(est); };
  }
  async function avanzar() {
    if (ocupado || !est) return;
    ocupado = true;
    const b = $('#bAvanzar'); if (b) b.disabled = true;
    try {
      const r = await S.rpc('profe_directo_avanzar', { p_sesion: sala, p_desde: est.estado });
      if (!r.ok && r.motivo !== 'estado_cambiado' && r.motivo !== 'terminada') alert('No se ha podido avanzar: ' + r.motivo);
      clearTimeout(sondeoId); sondear(++token);                       // se refresca ya, sin esperar al sondeo
    } catch (e) { if (String(e.message) !== '401') { avisoRed(true); if (b) b.disabled = false; } }
    ocupado = false;
  }
  async function cerrarSala() {
    if (!await confirmar('¿Cerrar la sala? Los alumnos verán el final.', 'Cerrar la sala')) return;
    try { await S.rpc('profe_directo_terminar', { p_sesion: sala }); clearTimeout(sondeoId); sondear(++token); } catch (e) { if (String(e.message) !== '401') alert(errorLegible(e)); }
  }
  function teclas(e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') && $('#bAvanzar') && $('#dialogo').hidden) { e.preventDefault(); avanzar(); }
  }

  // Todo definido: ya se puede arrancar
  if (S.hayRefresco()) arrancar(); else login();
})();
