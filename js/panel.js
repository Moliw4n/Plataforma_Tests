/* Panel del profesor · Plataforma de tests
   - Entra con tu usuario de Supabase (correo + contraseña).
   - Los NOMBRES reales salen de tu CSV privado y solo se guardan en este navegador
     (localStorage). Nunca se envían a Supabase ni a ningún sitio. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const CFG = window.CONFIG;
  const LET = 'ABCD';
  const NOMBRE_TIPO = { imprime: '¿Qué imprime?', error: 'Encuentra el error', hueco: 'Completa el hueco' };
  const TESTS_CONOCIDOS = ['tda2-u1-python-practica', 'tda1-u1u2-repaso'];
  const chipTipo = (T, t) => { const d = T && T.tipos && T.tipos[t];
    return d ? '<span class="tipo" style="background:var(--' + d.color + ')">' + esc(d.nombre) + '</span>'
             : '<span class="tipo t-' + t + '">' + (NOMBRE_TIPO[t] || t) + '</span>'; };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const app = $('#app');

  /* ---------- almacenamiento local (solo este navegador) ---------- */
  const guarda = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const sesionTab = {
    get() { try { return JSON.parse(sessionStorage.getItem('pt_sesion')); } catch (e) { return null; } },
    set(v) { try { sessionStorage.setItem('pt_sesion', JSON.stringify(v)); } catch (e) {} },
    del() { try { sessionStorage.removeItem('pt_sesion'); } catch (e) {} }
  };

  /* ---------- estado ---------- */
  let ses = null;                 // {token, email, exp}
  let grupos = [], alumnos = [], intentos = [];
  const tests = {};               // id -> test JSON
  let nombres = guarda.get('pt_nombres', {});   // 'TDA2-07' -> 'Nombre'
  const f = guarda.get('pt_filtros', { grupo: '', test: '', vista: 'alumnos', soloPrimero: false });
  let orden = { col: 'num', asc: true };

  /* ---------- red ---------- */
  async function api(ruta, opciones = {}) {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + ruta, {
      ...opciones,
      headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + ses.token, 'Content-Type': 'application/json', ...(opciones.headers || {}) }
    });
    if (r.status === 401) { cerrarSesion('Tu sesión ha caducado. Vuelve a entrar.'); throw new Error('401'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.status === 204 ? null : r.json();
  }

  /* ---------- login ---------- */
  function pantallaLogin(msg) {
    $('#usuario').hidden = true;
    app.innerHTML =
      '<form class="login" id="fLogin">' +
        '<h1>Panel del <span>profesor</span></h1>' +
        '<div class="campo"><label for="iEmail">CORREO</label><input id="iEmail" type="email" autocomplete="username" required></div>' +
        '<div class="campo"><label for="iPass">CONTRASEÑA</label><input id="iPass" type="password" autocomplete="current-password" required></div>' +
        '<button class="btn pri" id="bLogin" style="justify-content:center;padding:14px">Entrar →</button>' +
        '<p class="msg-error" id="msgLogin" role="status">' + esc(msg || '') + '</p>' +
      '</form>';
    $('#fLogin').onsubmit = async e => {
      e.preventDefault();
      $('#bLogin').disabled = true; $('#msgLogin').textContent = '';
      try {
        const r = await fetch(CFG.supabaseUrl + '/auth/v1/token?grant_type=password', {
          method: 'POST', headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: $('#iEmail').value.trim(), password: $('#iPass').value })
        });
        const d = await r.json();
        if (!r.ok || !d.access_token) throw new Error(d.error_description || d.msg || 'credenciales');
        ses = { token: d.access_token, email: (d.user && d.user.email) || $('#iEmail').value.trim(), exp: Date.now() + (d.expires_in || 3600) * 1000 };
        sesionTab.set(ses);
        arrancar();
      } catch (err) {
        $('#msgLogin').textContent = /fetch|network/i.test(String(err)) ? 'No hay conexión con Supabase.' : 'Correo o contraseña incorrectos.';
        $('#bLogin').disabled = false;
      }
    };
    $('#iEmail').focus();
  }
  function cerrarSesion(msg) { ses = null; sesionTab.del(); pantallaLogin(msg); }

  /* ---------- carga ---------- */
  async function arrancar() {
    $('#usuario').hidden = false;
    $('#usuario').innerHTML = esc(ses.email) + ' <button class="btn" id="bSalir">Salir</button>';
    $('#bSalir').onclick = () => cerrarSesion('Has salido.');
    app.innerHTML = '<div class="cargando">Cargando resultados…</div>';
    try {
      [grupos, alumnos, intentos] = await Promise.all([
        api('grupos?select=id,nombre&order=id'),
        api('alumnos?select=id,grupo,activo&order=id'),
        api('intentos?select=id,alumno,test_id,version,empezado,terminado,segundos,total,aciertos,nota,respuestas&order=terminado.desc&limit=5000')
      ]);
    } catch (e) {
      if (String(e) !== 'Error: 401') app.innerHTML = '<div class="vacio">No se han podido cargar los datos (' + esc(e.message) + ').</div>';
      return;
    }
    if (!grupos.length) {
      app.innerHTML = '<div class="vacio">Has entrado, pero tu correo no está dado de alta como profesor.<br><br>' +
        'En Supabase → SQL Editor ejecuta:<br><code>insert into public.profesores(email) values (\'' + esc(ses.email) + '\');</code><br><br>y recarga esta página.</div>';
      return;
    }
    const ids = [...new Set([...TESTS_CONOCIDOS, ...intentos.map(i => i.test_id)])];
    await Promise.all(ids.map(async id => {
      try { const r = await fetch('tests/' + encodeURIComponent(id) + '.json', { cache: 'no-cache' }); if (r.ok) tests[id] = await r.json(); } catch (e) {}
    }));
    if (!grupos.some(g => g.id === f.grupo)) f.grupo = grupos[0].id;
    if (!ids.includes(f.test)) f.test = testDelGrupo(ids);
    pintar();
  }

  // Cada test es de un grupo: 'tda1-…' → TDA1. Al cambiar de grupo se elige su test.
  const testDelGrupo = ids => ids.find(id => id.toUpperCase().startsWith(f.grupo.toUpperCase() + '-')) || ids[0];

  /* ---------- utilidades ---------- */
  const nombreDe = id => nombres[id] || '';
  const numDe = id => id.split('-').pop();
  const claseNota = n => n == null ? '' : n >= 9 ? 'n-sb' : n >= 7 ? 'n-nt' : n >= 5 ? 'n-ap' : 'n-ss';
  const fmtNota = n => n == null ? '—' : '<span class="nota ' + claseNota(n) + '">' + Number(n).toFixed(1).replace('.', ',') + '</span>';
  const fmtNotaTxt = n => n == null ? '' : Number(n).toFixed(1).replace('.', ',');
  const fmtSeg = s => { if (s == null || isNaN(s)) return '—'; s = Math.round(s); const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ':' + String(s % 60).padStart(2, '0'); };
  const fmtFecha = t => t ? new Date(t).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const mediana = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

  function datosFiltrados() {
    const als = alumnos.filter(a => a.grupo === f.grupo);
    const idsGrupo = new Set(als.map(a => a.id));
    const ints = intentos.filter(i => i.test_id === f.test && idsGrupo.has(i.alumno));
    return { als, ints };
  }
  function filas() {
    const { als, ints } = datosFiltrados();
    return als.map(a => {
      const mios = ints.filter(i => i.alumno === a.id).sort((x, y) => new Date(x.terminado) - new Date(y.terminado));
      const notas = mios.map(i => Number(i.nota));
      const ult = mios[mios.length - 1];
      return {
        id: a.id, num: numDe(a.id), nombre: nombreDe(a.id), activo: a.activo, intentos: mios,
        n: mios.length, mejor: notas.length ? Math.max(...notas) : null, primera: notas.length ? notas[0] : null,
        ultima: ult ? Number(ult.nota) : null, media: media(notas), tUlt: ult ? ult.segundos : null,
        tTotal: mios.reduce((s, i) => s + (i.segundos || 0), 0), fecha: ult ? ult.terminado : null
      };
    });
  }

  /* ---------- pintar ---------- */
  function pintar() {
    guarda.set('pt_filtros', f);
    const T = tests[f.test];
    const hayNombres = Object.keys(nombres).length > 0;
    const fs = filas();
    const hechos = fs.filter(x => x.n);
    const todos = fs.flatMap(x => x.intentos);
    const pregs = estadisticasPreguntas();
    const peor = pregs[0];

    let h = '<div class="filtros">' +
      '<div class="campo"><label for="sGrupo">GRUPO</label><select id="sGrupo">' + grupos.map(g => '<option value="' + esc(g.id) + '"' + (g.id === f.grupo ? ' selected' : '') + '>' + esc(g.nombre) + '</option>').join('') + '</select></div>' +
      '<div class="campo"><label for="sTest">TEST</label><select id="sTest">' + Object.keys(tests).concat([...new Set(intentos.map(i => i.test_id))].filter(id => !tests[id])).map(id => '<option value="' + esc(id) + '"' + (id === f.test ? ' selected' : '') + '>' + esc(tests[id] ? tests[id].titulo : id) + '</option>').join('') + '</select></div>' +
      '<span class="espacio"></span>' +
      '<button class="btn" id="bRecargar">↻ Actualizar</button>' +
      '<button class="btn pri" id="bExcel">⬇ Descargar para Excel</button>' +
    '</div>';

    h += hayNombres
      ? '<div class="nombres-ok">👤 Nombres cargados desde tu archivo (solo en este navegador). <button class="enlace" id="bCambiarCSV">Cambiar archivo</button> · <button class="enlace" id="bOlvidar">Olvidar nombres</button></div>'
      : '<div class="aviso-nombres">Ahora ves solo números. Para ver los nombres, elige tu archivo <b>TDA2_alumnos.csv</b> (carpeta Plataforma_Tests_privado). No se sube a ningún sitio. <button class="btn" id="bCSV">Elegir archivo…</button></div>';
    h += '<input type="file" id="iCSV" accept=".csv,text/csv" hidden>';

    h += '<div class="resumen">' +
      '<div class="regla"><span class="g">' + hechos.length + '<small style="font-size:16px;color:var(--mut)">/' + fs.length + '</small></span><p>alumnos lo han hecho</p></div>' +
      '<div class="regla"><span class="g">' + (hechos.length ? fmtNotaTxt(media(hechos.map(x => x.mejor))) : '—') + '</span><p>nota media (mejor intento)</p></div>' +
      '<div class="regla"><span class="g">' + (hechos.length ? fmtNotaTxt(media(hechos.map(x => x.primera))) : '—') + '</span><p>nota media (primer intento)</p></div>' +
      '<div class="regla"><span class="g">' + todos.length + '</span><p>intentos en total</p></div>' +
      '<div class="regla"><span class="g">' + fmtSeg(mediana(todos.map(i => i.segundos).filter(s => s != null))) + '</span><p>tiempo típico por intento</p></div>' +
      '<div class="regla"><span class="g" style="color:var(--rojo)">' + (peor && peor.n ? Math.round(peor.pct) + '%' : '—') + '</span><p>fallo en la pregunta más difícil' + (peor && peor.n ? ' (' + esc(peor.id) + ')' : '') + '</p></div>' +
    '</div>';

    h += '<div class="tabs"><button data-v="alumnos" class="' + (f.vista === 'alumnos' ? 'on' : '') + '">ALUMNOS</button><button data-v="preguntas" class="' + (f.vista === 'preguntas' ? 'on' : '') + '">PREGUNTAS MÁS FALLADAS</button></div>';
    h += '<div id="vista"></div>';
    app.innerHTML = h;

    $('#sGrupo').onchange = e => {
      f.grupo = e.target.value;
      if (!f.test.toUpperCase().startsWith(f.grupo.toUpperCase() + '-')) f.test = testDelGrupo(Object.keys(tests));
      pintar();
    };
    $('#sTest').onchange = e => { f.test = e.target.value; pintar(); };
    $('#bRecargar').onclick = arrancar;
    $('#bExcel').onclick = exportar;
    const iCSV = $('#iCSV');
    iCSV.onchange = () => leerCSV(iCSV.files[0]);
    if ($('#bCSV')) $('#bCSV').onclick = () => iCSV.click();
    if ($('#bCambiarCSV')) $('#bCambiarCSV').onclick = () => iCSV.click();
    if ($('#bOlvidar')) $('#bOlvidar').onclick = () => { nombres = {}; guarda.del('pt_nombres'); pintar(); };
    app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { f.vista = b.dataset.v; pintar(); });
    if (f.vista === 'preguntas') vistaPreguntas(pregs, T); else vistaAlumnos(fs);
  }

  /* ---------- vista: alumnos ---------- */
  const COLS = [
    ['num', 'Nº'], ['nombre', 'Nombre'], ['n', 'Intentos'], ['mejor', 'Mejor'], ['primera', 'Primera'], ['ultima', 'Última'],
    ['media', 'Media'], ['tUlt', 'Tiempo último'], ['tTotal', 'Tiempo total'], ['fecha', 'Último intento']
  ];
  function vistaAlumnos(fs) {
    const c = orden.col, s = orden.asc ? 1 : -1;
    fs.sort((a, b) => {
      let x = a[c], y = b[c];
      if (c === 'fecha') { x = x ? +new Date(x) : null; y = y ? +new Date(y) : null; }
      if (x == null || x === '') return 1; if (y == null || y === '') return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'es') : x - y) * s;
    });
    const hayNombres = Object.keys(nombres).length > 0;
    let h = '<div class="tabla-wrap"><table class="datos"><thead><tr>' +
      COLS.filter(([k]) => hayNombres || k !== 'nombre').map(([k, t]) => '<th data-c="' + k + '" class="' + (k === c ? 'orden' + (orden.asc ? ' asc' : '') : '') + '">' + t + '</th>').join('') +
      '</tr></thead><tbody>';
    h += fs.map(x => '<tr data-id="' + esc(x.id) + '" class="' + (x.n ? '' : 'sin') + '">' +
      '<td class="num">' + esc(x.num) + '</td>' +
      (hayNombres ? '<td>' + (esc(x.nombre) || '<span style="color:var(--mut)">¿?</span>') + '</td>' : '') +
      '<td>' + (x.n ? '<span class="estado"><i></i>' + x.n + '</span>' : '<span class="estado no"><i></i>sin hacer</span>') + '</td>' +
      '<td>' + fmtNota(x.mejor) + '</td><td>' + fmtNota(x.primera) + '</td><td>' + fmtNota(x.ultima) + '</td>' +
      '<td>' + (x.media == null ? '—' : fmtNotaTxt(x.media)) + '</td>' +
      '<td>' + fmtSeg(x.tUlt) + '</td><td>' + (x.n ? fmtSeg(x.tTotal) : '—') + '</td><td>' + fmtFecha(x.fecha) + '</td>' +
    '</tr>').join('');
    h += '</tbody></table></div><p class="dato-p">Pulsa un alumno para ver sus intentos uno a uno. Pulsa una cabecera para ordenar.</p>';
    $('#vista').innerHTML = h;
    $('#vista').querySelectorAll('th').forEach(th => th.onclick = () => {
      const k = th.dataset.c; orden = { col: k, asc: orden.col === k ? !orden.asc : (k === 'num' || k === 'nombre') }; pintar();
    });
    $('#vista').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => abrirDetalle(tr.dataset.id));
  }

  /* ---------- vista: preguntas ---------- */
  function estadisticasPreguntas() {
    const { ints } = datosFiltrados();
    let usar = ints;
    if (f.soloPrimero) {
      const primero = {};
      [...ints].sort((a, b) => new Date(a.terminado) - new Date(b.terminado)).forEach(i => { if (!primero[i.alumno]) primero[i.alumno] = i; });
      usar = Object.values(primero);
    }
    const st = {};
    const T = tests[f.test];
    if (T) T.preguntas.forEach((p, k) => st[p.id] = { id: p.id, k, p, n: 0, mal: 0, elegidas: {}, ms: [] });
    usar.forEach(i => (i.respuestas || []).forEach(r => {
      const s = st[r.id] || (st[r.id] = { id: r.id, k: 999, p: null, n: 0, mal: 0, elegidas: {}, ms: [] });
      s.n++; if (!r.ok) s.mal++;
      if (r.elegida != null) s.elegidas[r.elegida] = (s.elegidas[r.elegida] || 0) + 1;
      if (r.ms) s.ms.push(r.ms);
    }));
    return Object.values(st).map(s => ({ ...s, pct: s.n ? s.mal / s.n * 100 : 0 }))
      .sort((a, b) => (b.n ? 1 : 0) - (a.n ? 1 : 0) || b.pct - a.pct || a.k - b.k);
  }
  function vistaPreguntas(pregs, T) {
    let h = '<div class="filtros"><div class="campo"><label for="sCuenta">CONTAR</label><select id="sCuenta">' +
      '<option value="todos"' + (f.soloPrimero ? '' : ' selected') + '>Todos los intentos</option>' +
      '<option value="primero"' + (f.soloPrimero ? ' selected' : '') + '>Solo el primer intento de cada alumno</option></select></div></div>';
    if (!pregs.some(p => p.n)) h += '<div class="vacio">Todavía nadie de este grupo ha hecho este test.</div>';
    h += '<div class="preguntas">' + pregs.filter(s => s.n).map(s => {
      const p = s.p;
      const reparto = p ? p.ops.map((o, j) => ({ j, o, c: s.elegidas[j] || 0 })) : [];
      const maxC = Math.max(1, ...reparto.map(x => x.c));
      const peorOp = reparto.filter(x => p && x.j !== p.ok).sort((a, b) => b.c - a.c)[0];
      return '<div class="pfila">' +
        '<div>' +
          '<div class="cab-p"><span class="idp">' + esc(s.id.toUpperCase()) + '</span>' + (p ? chipTipo(T, p.tipo) + '<span class="act">' + esc(p.act) + '</span>' : '') + '</div>' +
          (p ? '<div class="enun-p">' + esc(p.enun) + '</div><details><summary>Ver ' + (p.code ? 'código y ' : '') + 'opciones</summary>' + (p.code ? '<pre class="codigo">' + esc(p.code) + '</pre>' : '') +
            '<div class="reparto" style="margin-top:10px">' + reparto.map(x => '<div class="' + (x.j === p.ok ? 'ok' : '') + '"><span class="l">' + LET[x.j] + '</span><code style="white-space:pre-wrap;font-size:13px">' + esc(x.o) + '</code><span>' + x.c + '</span></div>').join('') + '</div></details>' : '<div class="enun-p">(pregunta que ya no está en el test)</div>') +
          (peorOp && peorOp.c ? '<div class="trampa-mas"><b>LA RESPUESTA EQUIVOCADA MÁS ELEGIDA · ' + peorOp.c + ' VECES</b><code>' + esc(peorOp.o) + '</code></div>' : '') +
        '</div>' +
        '<div class="lado">' +
          '<div class="pct" style="color:' + (s.pct >= 50 ? 'var(--rojo)' : s.pct >= 25 ? 'var(--ambar)' : 'var(--verde)') + '">' + Math.round(s.pct) + '%<small>DE FALLO</small></div>' +
          '<div class="barra-fallo"><i style="width:' + s.pct + '%"></i></div>' +
          '<div class="dato-p">' + s.mal + ' fallos de ' + s.n + ' respuestas</div>' +
          '<div class="dato-p">Tiempo típico: ' + fmtSeg((mediana(s.ms) || 0) / 1000) + '</div>' +
          (p ? '<div class="reparto">' + reparto.map(x => '<div class="' + (x.j === p.ok ? 'ok' : '') + '" title="' + esc(x.o) + '"><span class="l">' + LET[x.j] + (x.j === p.ok ? '✓' : '') + '</span><span class="b"><i style="width:' + (x.c / maxC * 100) + '%"></i></span><span>' + x.c + '</span></div>').join('') + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
    $('#vista').innerHTML = h;
    $('#sCuenta').onchange = e => { f.soloPrimero = e.target.value === 'primero'; pintar(); };
  }

  /* ---------- detalle de un alumno ---------- */
  const capa = $('#capaDetalle');
  $('#bCerrarDetalle').onclick = () => capa.classList.remove('on');
  capa.addEventListener('click', e => { if (e.target === capa) capa.classList.remove('on'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') capa.classList.remove('on'); });

  function abrirDetalle(id) {
    const x = filas().find(r => r.id === id); if (!x) return;
    const T = tests[f.test];
    $('#tituloDetalle').textContent = 'Nº ' + x.num + (x.nombre ? ' · ' + x.nombre.toUpperCase() : '');
    const cuerpo = $('#cuerpoDetalle');
    if (!x.n) { cuerpo.innerHTML = '<div class="vacio">Todavía no ha hecho este test.</div>'; capa.classList.add('on'); return; }
    cuerpo.innerHTML = '<p class="leyenda-mapa">Cada casilla es una pregunta, en el orden en que la contestó, con el tiempo que tardó. <span></span>= tardó mucho más de lo normal para él.</p>' +
      [...x.intentos].reverse().map((i, k) => {
        const rs = i.respuestas || [];
        const med = mediana(rs.map(r => r.ms || 0));
        return '<div class="intento" data-int="' + i.id + '">' +
          '<div class="cab-i">' + fmtNota(Number(i.nota)) + '<span class="fecha">Intento ' + (x.n - k) + ' · ' + esc(fmtFecha(i.terminado)) + '</span>' +
            '<span class="dato-p">' + i.aciertos + '/' + i.total + ' bien · ' + fmtSeg(i.segundos) + '</span>' +
            '<button class="btn peligro" data-borrar="' + i.id + '">Borrar intento</button></div>' +
          '<div class="mapa">' + rs.map((r, j) => {
            const k2 = T ? T.preguntas.findIndex(p => p.id === r.id) : -1;
            return '<button class="' + (r.ok ? 'ok' : 'mal') + (med && r.ms > Math.max(2.5 * med, 20000) ? ' lento' : '') + '" data-q="' + esc(r.id) + '" data-j="' + j + '" title="' + esc(r.id) + '">' + (k2 >= 0 ? k2 + 1 : esc(r.id)) + '<small>' + fmtSeg((r.ms || 0) / 1000) + '</small></button>';
          }).join('') + '</div>' +
          '<div class="ver-p" hidden></div>' +
        '</div>';
      }).join('');
    cuerpo.querySelectorAll('.mapa button').forEach(b => b.onclick = () => {
      const caja = b.closest('.intento'), ver = caja.querySelector('.ver-p');
      const i = x.intentos.find(z => String(z.id) === caja.dataset.int);
      const r = i.respuestas[+b.dataset.j];
      const p = T && T.preguntas.find(q => q.id === r.id);
      caja.querySelectorAll('.mapa button').forEach(o => o.classList.toggle('on', o === b));
      ver.hidden = false;
      ver.innerHTML = !p ? 'Esta pregunta ya no está en el test.' :
        '<div class="cab-p">' + chipTipo(T, p.tipo) + ' <b>' + esc(p.enun) + '</b></div>' +
        (p.code ? '<pre class="codigo" style="font-size:14px;padding:10px 12px">' + esc(p.code) + '</pre>' : '') +
        p.ops.map((o, j) => '<div class="op-mini' + (j === p.ok ? ' ok' : '') + (j === r.elegida ? ' elegida' + (r.ok ? '' : ' mal') : '') + '"><b>' + LET[j] + '</b><code>' + esc(o) + '</code><span class="m">' + (j === r.elegida ? (r.ok ? '✓ eligió esta' : '✗ eligió esta') : (j === p.ok ? '✓ correcta' : '')) + '</span></div>').join('') +
        '<div class="dato-p">Tardó ' + fmtSeg((r.ms || 0) / 1000) + ' en contestar.</div>';
    });
    cuerpo.querySelectorAll('[data-borrar]').forEach(b => b.onclick = () => borrarIntento(+b.dataset.borrar, x));
    capa.classList.add('on');
  }

  function confirmar(texto) {
    return new Promise(res => {
      const d = $('#dialogo'); $('#dlgTexto').textContent = texto; d.hidden = false; $('#dlgNo').focus();
      const fin = v => { d.hidden = true; res(v); };
      $('#dlgSi').onclick = () => fin(true); $('#dlgNo').onclick = () => fin(false);
    });
  }
  async function borrarIntento(idInt, x) {
    const i = intentos.find(z => z.id === idInt);
    if (!await confirmar('¿Borrar el intento del ' + fmtFecha(i.terminado) + ' (nota ' + fmtNotaTxt(i.nota) + ') del nº ' + x.num + (x.nombre ? ', ' + x.nombre : '') + '? No se puede deshacer.')) return;
    try {
      await api('intentos?id=eq.' + idInt, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      intentos = intentos.filter(z => z.id !== idInt);
      pintar(); abrirDetalle(x.id);
    } catch (e) { if (String(e) !== 'Error: 401') alert('No se ha podido borrar.'); }
  }

  /* ---------- nombres desde el CSV ---------- */
  function leerCSV(file) {
    if (!file) return;
    const lector = new FileReader();
    lector.onload = () => {
      const lineas = String(lector.result).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
      const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';
      const nuevo = {};
      lineas.forEach(l => {
        const c = l.split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
        if (/^[A-Z0-9]+-\d+$/i.test(c[0]) && c[1]) nuevo[c[0].toUpperCase()] = c[1];   // solo número → nombre; el código NO se guarda
      });
      if (!Object.keys(nuevo).length) { alert('No he encontrado alumnos en ese archivo. Debe ser TDA2_alumnos.csv.'); return; }
      nombres = { ...nombres, ...nuevo };
      guarda.set('pt_nombres', nombres);
      pintar();
    };
    lector.readAsText(file, 'utf-8');
  }

  /* ---------- exportar ---------- */
  function exportar() {
    const T = tests[f.test];
    const fs = filas().sort((a, b) => a.num.localeCompare(b.num, 'es', { numeric: true }));
    const cab = ['Nº', 'Nombre', 'Intentos', 'Mejor nota', 'Primera nota', 'Última nota', 'Nota media', 'Tiempo último intento', 'Tiempo total', 'Fecha último intento'];
    const filasCSV = fs.map(x => [x.num, x.nombre, x.n, fmtNotaTxt(x.mejor), fmtNotaTxt(x.primera), fmtNotaTxt(x.ultima), fmtNotaTxt(x.media),
      x.tUlt == null ? '' : fmtSeg(x.tUlt), x.n ? fmtSeg(x.tTotal) : '', x.fecha ? new Date(x.fecha).toLocaleString('es-ES') : '']);
    const csv = '﻿' + [cab, ...filasCSV].map(r => r.map(v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = f.grupo + '_' + (T ? T.id : f.test) + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- inicio ---------- */
  ses = sesionTab.get();
  if (ses && ses.exp > Date.now() + 60000) arrancar(); else pantallaLogin();
})();
