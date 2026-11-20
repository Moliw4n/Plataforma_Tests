/* Plataforma de tests · página del alumno
   Abre: test.html?t=<id-del-test>   (carga tests/<id>.json)
   De momento funciona sin conexión a la base de datos: el resultado de cada intento
   queda en `intento` y se pasa a guardarIntento(), que más adelante enviará a Supabase. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const LET = 'ABCD';
  const NOMBRE_TIPO = { imprime: '¿Qué imprime?', error: 'Encuentra el error', hueco: 'Completa el hueco' };
  // Etiqueta de tipo: usa los tipos del test si los trae ({tipos:{id:{nombre,color}}})
  const chipTipo = t => { const d = T && T.tipos && T.tipos[t];
    return d ? '<span class="tipo" style="background:var(--' + d.color + ')">' + esc(d.nombre) + '</span>'
             : '<span class="tipo t-' + t + '">' + (NOMBRE_TIPO[t] || t) + '</span>'; };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- resaltado de Python ---------- */
  const KW = new Set(['def','return','if','elif','else','for','while','in','and','or','not','break','continue','True','False','None','global','import','from','as','pass']);
  const BI = new Set(['print','input','int','float','str','len','range','sorted','sum','max','min','type','round','abs','list']);
  function pinta(code) {
    const re = /(#[^\n]*)|(f?"[^"\n]*"|f?'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|(________)|(\.[A-Za-z_]\w*(?=\())|([A-Za-z_]\w*)|([\s\S])/g;
    let o = '', m;
    while ((m = re.exec(code))) {
      if (m[1]) o += '<span class="c">' + esc(m[1]) + '</span>';
      else if (m[2]) o += '<span class="s">' + esc(m[2]) + '</span>';
      else if (m[3]) o += '<span class="n">' + m[3] + '</span>';
      else if (m[4]) o += '<span class="hueco">?</span>';
      else if (m[5]) o += '.<span class="m">' + esc(m[5].slice(1)) + '</span>';
      else if (m[6]) o += KW.has(m[6]) ? '<span class="k">' + m[6] + '</span>' : BI.has(m[6]) ? '<span class="f">' + m[6] + '</span>' : m[6];
      else o += esc(m[7]);
    }
    return o;
  }
  const conLineas = code => pinta(code).split('\n').map((l, i) => '<span class="ln">' + (i + 1) + '</span>' + l).join('\n');
  const consola = txt => esc(txt).split('\n').map(l => /^(\w+Error)\b/.test(l) ? '<span class="err">' + l + '</span>' : l).join('\n');
  function barajar(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------- estado ---------- */
  let T = null;            // el test
  let lista = [];          // preguntas de este intento: {p, orden:[índices de opciones]}
  let pos = 0;
  let resp = [];           // por posición: {elegida (índice original), ok, ms}
  let t0 = 0, inicioIntento = 0;
  let intento = null;
  let sesion = null;       // {codigo, alumno, grupo} · solo en memoria: al cerrar la pestaña, desaparece
  const CFG = window.CONFIG || null;
  // Modo profesor (test.html?t=…&modo=profe): sin código y sin guardar nada.
  const MODO_PROFE = new URLSearchParams(location.search).get('modo') === 'profe';

  async function rpc(fn, args) {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'apikey': CFG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  const E = $('#escena'), barra = $('#barra');

  /* ---------- carga ---------- */
  async function cargar() {
    const id = new URLSearchParams(location.search).get('t') || window.TEST_POR_DEFECTO;
    try {
      if (window.TEST_EMBEBIDO) T = window.TEST_EMBEBIDO;
      else { const r = await fetch('tests/' + encodeURIComponent(id) + '.json', { cache: 'no-cache' }); if (!r.ok) throw 0; T = await r.json(); }
    } catch (e) {
      E.innerHTML = '<div class="cargando">No encuentro este test. Revisa el enlace que te ha pasado tu profesor.</div>';
      return;
    }
    document.title = T.titulo + ' · Kairos';
    $('#marca').innerHTML = 'KAIR<b class="k0">0</b>S <span>· ' + esc(T.materia || '') + ' · ' + esc(T.titulo) + '</span>';
    if (T.chuleta) prepararChuleta();
    if (MODO_PROFE) {
      document.body.classList.add('modo-profe');
      $('#marca').innerHTML = '<span class="aviso-profe">PROFE · NO SE GUARDA</span>';
    }
    if (CFG && !MODO_PROFE) acceso(); else portada();
  }

  /* ---------- acceso con código ---------- */
  function acceso(mensaje) {
    $('#bot').hidden = true; barra.innerHTML = ''; $('#contador').textContent = '';
    E.innerHTML =
      '<div class="portada acceso">' +
        '<div class="sup">' + esc((T.materia || '') + (T.unidad ? ' · ' + T.unidad : '')).toUpperCase() + '</div>' +
        '<h1>' + tituloBonito(T.titulo) + '</h1>' +
        '<form class="caja-codigo" id="fAcceso" autocomplete="off">' +
          '<label for="iCodigo">Escribe tu código</label>' +
          '<input id="iCodigo" class="orb" inputmode="text" autocapitalize="characters" spellcheck="false" maxlength="7" placeholder="ABC-123" aria-describedby="msgAcceso">' +
          '<button class="btn pri" id="bEntrar">Entrar →</button>' +
          '<p class="msg" id="msgAcceso" role="status">' + (mensaje || 'Es el de tu tarjeta. Lo tienes que escribir cada vez que entres.') + '</p>' +
        '</form>' +
      '</div>';
    const inp = $('#iCodigo');
    inp.addEventListener('input', () => {
      const v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      inp.value = v.length > 3 ? v.slice(0, 3) + '-' + v.slice(3) : v;
      inp.classList.remove('mal');
    });
    $('#fAcceso').onsubmit = async e => {
      e.preventDefault();
      const codigo = inp.value.replace(/[^A-Z0-9]/g, '');
      const msg = $('#msgAcceso');
      if (codigo.length !== 6) { msg.textContent = 'El código tiene 6 caracteres, por ejemplo ABC-123.'; inp.classList.add('mal'); inp.focus(); return; }
      $('#bEntrar').disabled = true; msg.textContent = 'Comprobando…';
      try {
        const r = await rpc('entrar', { p_codigo: codigo });
        if (r.ok) { sesion = { codigo, alumno: r.alumno, grupo: r.grupo }; portada(); return; }
        msg.textContent = r.motivo === 'espera' ? 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.' : 'Ese código no existe. Revísalo: no hay ceros ni letras O.';
        inp.classList.add('mal');
      } catch (err) {
        msg.textContent = 'No hay conexión con el servidor. Comprueba internet y vuelve a probar.';
      }
      $('#bEntrar').disabled = false; inp.focus(); inp.select();
    };
    inp.focus();
  }
  function salir() { sesion = null; lista = []; acceso('Has salido. Escribe tu código para volver a entrar.'); }

  /* ---------- portada ---------- */
  function portada() {
    $('#bot').hidden = true; barra.innerHTML = ''; $('#contador').textContent = '';
    const n = T.preguntas.length;
    const tipos = [...new Set(T.preguntas.map(p => p.tipo))];
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
          (MODO_PROFE ? '<a class="btn" href="panel.html">← Volver al panel</a>' : '') +
          (sesion ? '<span class="quien">Entras como <b>nº ' + esc(sesion.alumno.split('-').pop()) + '</b> · <button class="enlace" id="bSalir">No soy yo</button></span>' : '') +
        '</div>' +
      '</div>';
    $('#bEmpezar').onclick = () => empezar(T.preguntas);
    if (sesion) $('#bSalir').onclick = salir;
    $('#bEmpezar').focus();
  }
  function tituloBonito(t) {
    const i = t.indexOf('·');
    return i < 0 ? esc(t) : esc(t.slice(0, i).trim()) + '<br><span>' + esc(t.slice(i + 1).trim()) + '</span>';
  }

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
    const r = resp[i];
    let h = '<div class="q' + (r ? ' resuelta' : '') + (p.code ? '' : ' sin-codigo') + '">';
    h += '<div class="izq"><div class="chips">' + chipTipo(p.tipo) + '<span class="act">' + esc(p.act || '') + '</span></div>';
    h += '<p class="enun">' + esc(p.enun) + '</p>';
    if (p.code) h += '<pre class="codigo">' + conLineas(p.code) + '</pre>';
    const htmlConsola = !p.salida ? '' : '<div class="consola"><span class="et">LO QUE SALE DE VERDAD' +
         (p.tipo === 'hueco' ? ' (CON LA BUENA)' : '') +
         (p.stdin ? ' · EL USUARIO ESCRIBE ' + esc(p.stdin.trim().split('\n').join(', ')) : '') +
         '</span><pre>' + consola(p.salida) + '</pre></div>';
    if (htmlConsola) h += '<div class="solu solo-escritorio">' + htmlConsola + '</div>';
    h += '</div><div class="der">';
    const mono = p.tipo === 'imprime' || p.tipo === 'hueco';
    h += '<div class="ops">' + orden.map((oi, j) => {
      const cls = ['op'];
      if (oi === p.ok) cls.push('ok');
      if (r && r.elegida === oi) cls.push('elegida', oi === p.ok ? 'bien' : 'mal');
      const marca = r ? (oi === p.ok ? '✓' : (r.elegida === oi ? '✗' : '')) : '';
      return '<button class="' + cls.join(' ') + '" data-oi="' + oi + '"' + (r ? ' disabled' : '') + '>' +
        '<span class="l">' + LET[j] + '</span><span class="tx' + (mono ? ' mono' : '') + '">' + (p.tipo === 'hueco' ? pinta(p.ops[oi]) : esc(p.ops[oi])) + '</span>' +
        '<span class="marca-op">' + marca + '</span></button>';
    }).join('') + '</div>';
    h += '<div class="veredicto"></div>';
    h += '<div class="solu">';
    if (htmlConsola) h += '<div class="solo-movil">' + htmlConsola + '</div>';
    if (p.sol) h += '<div class="caja porque"><b>POR QUÉ</b>' + esc(p.sol) + '</div>';
    if (p.trampa) h += '<div class="caja trampa"><b>LA TRAMPA</b>' + esc(p.trampa) + '</div>';
    if (T.chuleta && p.tema) h += '<button class="ver-chuleta" data-tema="' + esc(p.tema) + '">Repasar esto en la chuleta →</button>';
    h += '</div></div></div>';
    E.innerHTML = h;
    E.querySelectorAll('.op:not([disabled])').forEach(b => b.onclick = () => responder(+b.dataset.oi));
    const vc = E.querySelector('.ver-chuleta'); if (vc) vc.onclick = () => abrirChuleta(vc.dataset.tema);
    if (r) pintarVeredicto(r.ok);
    t0 = Date.now();
    actualizarBarra();
    window.scrollTo({ top: 0 });
  }
  function pintarVeredicto(bien) {
    const v = E.querySelector('.veredicto');
    v.className = 'veredicto ' + (bien ? 'bien' : 'fallo');
    v.innerHTML = '<span class="ico">' + (bien ? '✓' : '✗') + '</span>' + (bien ? '¡CORRECTO!' : 'NO ES ESA');
  }

  function responder(oi) {
    if (resp[pos]) return;
    const p = lista[pos].p;
    resp[pos] = { id: p.id, elegida: oi, ok: oi === p.ok, ms: Date.now() - t0 };
    E.querySelectorAll('.op').forEach(b => {
      const o = +b.dataset.oi;
      b.disabled = true;
      if (o === oi) b.classList.add('elegida', o === p.ok ? 'bien' : 'mal');
      b.querySelector('.marca-op').textContent = o === p.ok ? '✓' : (o === oi ? '✗' : '');
    });
    pintarVeredicto(oi === p.ok);
    E.querySelector('.q').classList.add('resuelta');
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

  $('#bAnt').onclick = () => { if (pos > 0) ir(pos - 1); };
  $('#bSig').onclick = siguiente;
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
  // Guarda el intento en Supabase. Estado: 'guardando' | 'ok' | 'error' | 'local'
  let estadoGuardado = 'local';
  async function guardarIntento(datos) {
    window.ultimoIntento = datos;
    if (MODO_PROFE) { estadoGuardado = 'profe'; pintarGuardado(); return; }
    if (!CFG || !sesion) { estadoGuardado = 'local'; return; }
    estadoGuardado = 'guardando'; pintarGuardado();
    try {
      const r = await rpc('guardar_intento', { p_codigo: sesion.codigo, p_datos: datos });
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
          (sesion ? '<button class="btn" id="bTerminar">Terminar y salir</button>' : '') +
        '</div>' +
      '</div>';
    pintarGuardado();
    requestAnimationFrame(() => requestAnimationFrame(() => { $('#aroValor').style.strokeDashoffset = C * (1 - aciertos / total); }));
    E.querySelectorAll('.rejilla button').forEach(b => b.onclick = () => { $('#bot').hidden = false; ir(+b.dataset.i); });
    if (falladas.length) $('#bFalladas').onclick = () => empezar(falladas);
    $('#bOtraVez').onclick = () => empezar(T.preguntas);
    if (sesion) $('#bTerminar').onclick = salir;
    window.scrollTo({ top: 0 });
  }
  function actualizarBarraFinal() {
    [...barra.children].forEach((el, i) => { el.className = resp[i] ? (resp[i].ok ? 'ok' : 'mal') : ''; });
    $('#contador').textContent = '';
  }

  /* ---------- chuleta ---------- */
  let chuletaLista = false;
  const capa = $('#capaChuleta');
  async function prepararChuleta() {
    $('#bChuleta').hidden = false;
    $('#bChuleta').onclick = () => abrirChuleta();
    $('#bCerrarChuleta').onclick = cerrarChuleta;
    capa.addEventListener('click', e => { if (e.target === capa) cerrarChuleta(); });
    try {
      const html = window.CHULETA_EMBEBIDA || await (await fetch(T.chuleta, { cache: 'no-cache' })).text();
      const cuerpo = $('#cuerpoChuleta');
      cuerpo.innerHTML = html;
      cuerpo.querySelectorAll('pre.py').forEach(pre => pre.innerHTML = pinta(pre.textContent.replace(/^\n/, '')));
      const secs = [...cuerpo.querySelectorAll('section')];
      $('#pestanas').innerHTML = secs.map(s => '<button data-tema="' + s.dataset.tema + '" data-color="' + (s.dataset.color || '') + '" style="--c:var(--' + (s.dataset.color || 'naranja') + ')">' + esc(s.dataset.nombre) + '</button>').join('');
      $('#pestanas').querySelectorAll('button').forEach(b => b.onclick = () => verTema(b.dataset.tema));
      $('#tituloChuleta').textContent = 'CHULETA · ' + (T.materia || '');
      chuletaLista = true;
      verTema(secs[0] && secs[0].dataset.tema);
    } catch (e) { $('#bChuleta').hidden = true; }
  }
  function verTema(tema) {
    const cuerpo = $('#cuerpoChuleta');
    let hay = false;
    cuerpo.querySelectorAll('section').forEach(s => { const on = s.dataset.tema === tema; s.classList.toggle('on', on); hay = hay || on; });
    if (!hay) { const s = cuerpo.querySelector('section'); if (s) { s.classList.add('on'); tema = s.dataset.tema; } }
    $('#pestanas').querySelectorAll('button').forEach(b => { const on = b.dataset.tema === tema; b.classList.toggle('on', on); if (on) b.scrollIntoView({ block: 'nearest', inline: 'center' }); });
    cuerpo.scrollTop = 0;
  }
  function abrirChuleta(tema) {
    if (!chuletaLista) return;
    const actual = lista[pos] && lista[pos].p.tema;
    verTema(tema || actual || null);
    capa.classList.add('on');
    $('#bCerrarChuleta').focus();
  }
  function cerrarChuleta() { capa.classList.remove('on'); }

  /* ---------- teclado ---------- */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (capa.classList.contains('on')) { if (e.key === 'Escape') cerrarChuleta(); return; }
    if ((e.key === 'c' || e.key === 'C') && chuletaLista) { abrirChuleta(); return; }
    if (!lista.length || pos < 0 || $('#bot').hidden) return;
    const n = '1234'.indexOf(e.key);
    if (n >= 0 && !resp[pos] && lista[pos].orden[n] !== undefined) { responder(lista[pos].orden[n]); return; }
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && resp[pos]) { e.preventDefault(); siguiente(); }
    if (e.key === 'ArrowLeft' && pos > 0) ir(pos - 1);
  });

  cargar();
})();
