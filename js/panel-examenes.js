/* Panel del profesor · EXÁMENES (módulo de panel.js).
   Subir bancos (con soluciones: el archivo se elige en tu ordenador y solo viaja al servidor, nunca al repositorio),
   crear un examen, ponérselo a un grupo, ver resultados, publicar las notas y ver qué preguntas fallan más.
   Habla con Supabase solo por las funciones profe_* (supabase/06, 07 y 08). P = lo que le presta panel.js. */
import { aFormato2, validarBanco } from './nucleo/formato.js';
import { NOMBRES_TIPO } from './nucleo/preguntas/comun.js';
import { icono } from './nucleo/iconos.js';

export function crearExamenes(P) {
  const { esc } = P;
  const $ = s => document.querySelector(s);
  let bancos = [], juegos = [], asignaciones = [];
  let usos = null;                  // intentos hechos por examen {id: n}; null = no se ha podido saber (no se bloquea nada: el servidor es quien manda)
  let res = null, est = null, tab = 'alumnos';
  let orden = { col: 'num', asc: true };

  const rpc = (fn, args) => P.api('rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });
  const fecha = t => new Date(String(t).replace(/(\.\d{3})\d+/, '$1'));            // Postgres da microsegundos y zona
  const ventana = a => { const n = Date.now(); return a.desde && n < fecha(a.desde) ? 'pronto' : a.hasta && n > fecha(a.hasta) ? 'cerrado' : 'abierto'; };
  const ROTULO = { abierto: 'Abierto', pronto: 'Aún no abierto', cerrado: 'Cerrado' };
  const ESTADO = { en_curso: 'En curso', entregada: 'Entregado', caducada: 'Se acabó el tiempo' };
  // El enlace para los alumnos. Si el panel está en el entorno de PRUEBAS, el enlace también (si no, los móviles abrirían la web con la base real)
  const enlaceExamen = id => new URL('jugar.html?j=' + encodeURIComponent(id) + (window.ENTORNO === 'pruebas' ? '&entorno=pruebas' : ''), location.href).href;
  const chip = t => '<span class="tipo t-' + esc(t) + '">' + esc(NOMBRES_TIPO[t] || t) + '</span>';
  const juegoDe = id => juegos.find(j => j.id === id) || { id, titulo: id, reglas: {} };

  /* El motivo que da el servidor, en cristiano */
  function errorLegible(e) {
    const d = (e && e.detalle) || '';
    if (/no_autorizado/.test(d)) return 'Tu sesión no tiene permiso de profesor.';
    if (/banco_en_uso/.test(d)) return 'Este banco ya lo usa algún examen (o ya hay exámenes hechos con él), así que no se puede cambiar ni borrar. Súbelo con otro id.';
    if (/juego_en_uso/.test(d)) return 'Ya hay alumnos que han hecho este examen: no se puede cambiar.';
    if (/asignacion_con_partidas/.test(d)) return 'Esta asignación ya tiene intentos de alumnos: no se puede quitar.';
    const m = d.match(/^(?:banco_no_valido|item_no_valido|juego_no_valido|reglas_no_validas|asignacion_no_valida): (.*)$/);
    if (m) return m[1];
    if (/demasiados|banco_demasiado_grande/.test(d)) return 'El banco es demasiado grande.';
    return e && e.status ? 'El servidor ha dicho que no (' + (d || 'HTTP ' + e.status) + ').' : 'No hay conexión con Supabase.';
  }
  function aviso(el, texto, malo = false) {
    const lineas = [].concat(texto).filter(Boolean);
    el.className = 'msg-ex ' + (malo ? 'mal' : 'bien'); el.setAttribute('role', malo ? 'alert' : 'status');
    el.innerHTML = lineas.map(l => '<div>' + esc(l) + '</div>').join('');
  }

  /* ---------- datos ---------- */
  async function cargar() {
    try {
      [bancos, juegos, asignaciones] = await Promise.all([
        P.api('bancos?select=id,titulo,materia,unidad,version&order=id'),
        P.api('juegos?select=id,modo,titulo,bancos,reglas&order=id'),
        P.api('asignaciones?select=id,juego,grupo,desde,hasta,intentos,mostrar_soluciones,notas_publicadas&order=id')
      ]);
      try {
        const ps = await P.api('partidas?select=asignacion&limit=10000');
        const juegoDeAsig = Object.fromEntries(asignaciones.map(a => [a.id, a.juego]));
        usos = {}; ps.forEach(x => { const j = juegoDeAsig[x.asignacion]; if (j) usos[j] = (usos[j] || 0) + 1; });
      } catch (e) { if (String(e) === 'Error: 401') throw e; usos = null; }
      return true;
    } catch (e) {
      if (String(e) === 'Error: 401') throw e;
      return false;                // las tablas de exámenes no existen todavía en esta base (o fallan): el panel sigue como antes
    }
  }
  async function recargarDatos() { await cargar(); }

  /* ---------- inicio: tarjetas de exámenes de un grupo ---------- */
  function tarjetas(grupoId) {
    const mias = asignaciones.filter(a => a.grupo === grupoId);
    if (!mias.length) return '';
    return '<div class="examenes-grupo"><h3>Exámenes</h3>' + mias.map(a => {
      const j = juegoDe(a.juego), v = ventana(a);
      return '<div class="test-card examen-card">' +
        '<div class="tc-tit"><b>' + esc(j.titulo) + '</b><span class="dato-p">' + esc(ROTULO[v]) +
          (a.desde ? ' · desde ' + esc(P.fmtFecha(a.desde)) : '') + (a.hasta ? ' · hasta ' + esc(P.fmtFecha(a.hasta)) : '') +
          ' · ' + a.intentos + (a.intentos === 1 ? ' intento' : ' intentos') + '</span></div>' +
        '<div class="tc-datos"><div><span class="g">' + (j.reglas.preguntas || '—') + '</span><span class="dato-p">preguntas</span></div>' +
          '<div><span class="g">' + (j.reglas.tiempo_min || '—') + '<small> min</small></span><span class="dato-p">de tiempo</span></div>' +
          '<div><span class="estado-notas ' + (a.notas_publicadas ? 'pub' : '') + '">' + (a.notas_publicadas ? 'Notas publicadas' : 'Notas ocultas') + '</span></div></div>' +
        '<div class="tc-acc"><button class="btn pri" data-ex-res="' + a.id + '">Ver resultados</button>' +
          '<button class="btn" data-ex-enlace="' + esc(enlaceExamen(a.juego)) + '">'+icono("enlace")+' Enlace</button></div></div>';
    }).join('') + '</div>';
  }
  function enlazarInicio() {
    const g = $('#bGestion'); if (g) g.onclick = () => { P.f.vista = 'gestion'; P.pintar(); window.scrollTo({ top: 0 }); };
    P.app.querySelectorAll('[data-ex-res]').forEach(b => b.onclick = () => { P.f.asignacion = +b.dataset.exRes; P.f.vista = 'examen'; tab = 'alumnos'; P.pintar(); window.scrollTo({ top: 0 }); });
    P.app.querySelectorAll('[data-ex-enlace]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.exEnlace); b.textContent = '✓ Copiado'; } catch (e) { prompt('Copia este enlace:', b.dataset.exEnlace); }
      setTimeout(() => b.innerHTML = icono('enlace') + ' Enlace', 2000);
    });
  }

  /* ---------- gestión: bancos, crear examen, asignar ---------- */
  function pintarGestion() {
    const hoy = bancos.length > 0;
    let h = '<div class="migas"><button class="btn" id="bInicio">'+icono("volver")+' Inicio</button></div><h1 class="tit-ex">Exámenes</h1>';
    h += '<section class="gestion" id="secBancos"><h2>1 · Bancos de preguntas</h2>' +
      '<p class="dato-p">Un banco son las preguntas con sus soluciones. Elige el archivo <b>.json</b> en tu ordenador: solo se sube al servidor (no va al repositorio público).</p>' +
      (hoy ? '<div class="tabla-ex"><table class="datos"><thead><tr><th>Id</th><th>Título</th><th>Versión</th><th></th></tr></thead><tbody>' +
        bancos.map(b => '<tr><td class="num">' + esc(b.id) + '</td><td>' + esc(b.titulo) + '</td><td>' + b.version + '</td><td><button class="btn peligro" data-borrar-banco="' + esc(b.id) + '">Borrar</button></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="vacio">Todavía no has subido ningún banco.</div>') +
      '<div class="fila-acc"><button class="btn pri" id="bSubirBanco">'+icono("subir")+' Subir banco (.json)</button><input type="file" id="iBanco" accept=".json,application/json" hidden></div>' +
      '<div class="msg-ex" id="msgBanco"></div></section>';
    h += '<section class="gestion" id="secJuego"><h2>2 · Crear un examen</h2>' + (hoy ?
      '<div class="msg-ex bien" id="avisoEdicion" hidden></div>' +
      '<form id="fJuego" class="form-ex"><div class="rejilla-form">' +
        '<div class="campo"><label for="jId">ID (para el enlace)</label><input id="jId" required pattern="[a-z0-9][a-z0-9_-]{0,59}" placeholder="u1-python-nov" autocomplete="off"></div>' +
        '<div class="campo"><label for="jTitulo">TÍTULO</label><input id="jTitulo" required placeholder="Examen U1 · Python" autocomplete="off"></div>' +
        '<div class="campo"><label>BANCOS</label><div class="checks">' + bancos.map(b => '<label><input type="checkbox" class="jBanco" value="' + esc(b.id) + '"> ' + esc(b.titulo) + '</label>').join('') + '</div></div>' +
        '<div class="campo"><label for="jPreg">PREGUNTAS</label><input id="jPreg" type="number" min="1" max="100" value="20"></div>' +
        '<div class="campo"><label for="jMin">MINUTOS</label><input id="jMin" type="number" min="1" max="300" value="30"></div>' +
        '<div class="campo"><label for="jPen">CADA FALLO</label><select id="jPen"><option value="0">No resta</option><option value="0.25">Resta ¼ de acierto</option><option value="0.33">Resta ⅓ de acierto</option><option value="0.5">Resta ½ acierto</option><option value="1">Resta un acierto</option></select></div>' +
        '<div class="campo"><label for="jEq">REPARTO</label><select id="jEq"><option value="tema">Equilibrado por temas</option><option value="ninguno">Al azar</option></select></div>' +
      '</div><button class="btn pri" id="bCrearJuego">Crear examen</button></form>' : '<div class="vacio">Primero sube un banco.</div>') +
      '<div class="msg-ex" id="msgJuego"></div>' +
      tablaJuegos() + '</section>';
    h += '<section class="gestion" id="secAsignar"><h2>3 · Ponerlo a un grupo</h2>' + (juegos.length ?
      '<form id="fAsignar" class="form-ex"><div class="rejilla-form">' +
        '<div class="campo"><label for="aJuego">EXAMEN</label><select id="aJuego">' + juegos.map(j => '<option value="' + esc(j.id) + '">' + esc(j.titulo) + '</option>').join('') + '</select></div>' +
        '<div class="campo"><label for="aGrupo">GRUPO</label><select id="aGrupo">' + P.grupos().map(g => '<option value="' + esc(g.id) + '">' + esc(g.nombre) + '</option>').join('') + '</select></div>' +
        '<div class="campo"><label>FECHAS</label><div class="checks"><label><input type="checkbox" id="aFechas"> Limitar por fechas (si no, siempre abierto)</label></div></div>' +
        '<div class="campo campo-fecha" hidden><label for="aDesde">SE ABRE</label><input id="aDesde" type="datetime-local"></div>' +
        '<div class="campo campo-fecha" hidden><label for="aHasta">ÚLTIMO MOMENTO PARA EMPEZAR</label><input id="aHasta" type="datetime-local"></div>' +
        '<div class="campo"><label for="aInt">INTENTOS</label><input id="aInt" type="number" min="1" max="10" value="1"></div>' +
        '<div class="campo"><label>SOLUCIONES</label><div class="checks"><label><input type="checkbox" id="aSol"> Enseñar la revisión cuando publique las notas</label></div></div>' +
      '</div><button class="btn pri" id="bAsignar">Poner el examen</button></form>' : '<div class="vacio">Primero crea un examen.</div>') +
      '<div class="msg-ex" id="msgAsignar"></div>' +
      (asignaciones.length ? '<div class="tabla-ex"><table class="datos"><thead><tr><th>Examen</th><th>Grupo</th><th>Estado</th><th>Intentos</th><th>Notas</th><th></th></tr></thead><tbody>' +
        asignaciones.map(a => '<tr><td>' + esc(juegoDe(a.juego).titulo) + '</td><td>' + esc(a.grupo) + '</td><td>' + esc(ROTULO[ventana(a)]) + '</td><td>' + a.intentos + '</td><td>' + (a.notas_publicadas ? 'publicadas' : 'ocultas') +
          '</td><td><button class="btn" data-ex-res="' + a.id + '">Resultados</button> <button class="btn" data-ex-enlace="' + esc(enlaceExamen(a.juego)) + '">'+icono("enlace")+' Enlace</button></td></tr>').join('') + '</tbody></table></div>' : '') + '</section>';
    P.app.innerHTML = h;

    $('#bInicio').onclick = () => { P.f.vista = 'inicio'; P.pintar(); };
    enlazarInicio();
    $('#bSubirBanco').onclick = () => $('#iBanco').click();
    $('#iBanco').onchange = () => { const a = $('#iBanco').files[0]; $('#iBanco').value = ''; if (a) subirBanco(a); };
    P.app.querySelectorAll('[data-borrar-banco]').forEach(b => b.onclick = () => borrarBanco(b.dataset.borrarBanco));
    if ($('#fJuego')) $('#fJuego').onsubmit = e => { e.preventDefault(); crearJuego(); };
    P.app.querySelectorAll('[data-ex-editar]').forEach(b => b.onclick = () => { if (!b.disabled) cargarEnFormulario(b.dataset.exEditar, 'editar'); });
    P.app.querySelectorAll('[data-ex-duplicar]').forEach(b => b.onclick = () => cargarEnFormulario(b.dataset.exDuplicar, 'duplicar'));
    if ($('#fAsignar')) {
      $('#fAsignar').onsubmit = e => { e.preventDefault(); asignar(); };
      // Las fechas solo existen si se marca la casilla (un campo de fecha vacío se ve «relleno» en Safari y confunde)
      $('#aFechas').onchange = () => {
        const on = $('#aFechas').checked;
        P.app.querySelectorAll('.campo-fecha').forEach(c => { c.hidden = !on; });
        if (on) {
          const local = d => { const p2 = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
          const ahora = new Date(); ahora.setSeconds(0, 0);
          if (!$('#aDesde').value) $('#aDesde').value = local(ahora);
          if (!$('#aHasta').value) $('#aHasta').value = local(new Date(ahora.getTime() + 2 * 3600e3));
        }
      };
    }
  }

  async function subirBanco(archivo) {
    const msg = $('#msgBanco');
    let banco;
    try { banco = JSON.parse((await archivo.text()).replace(/^﻿/, '')); }
    catch (e) { return aviso(msg, 'El archivo no es un JSON válido.', true); }
    banco = aFormato2(banco);
    const problemas = validarBanco(banco);
    if (problemas.length) return aviso(msg, ['El banco tiene problemas, no se ha subido nada:', ...problemas.slice(0, 8), problemas.length > 8 ? '… y ' + (problemas.length - 8) + ' más.' : ''], true);
    const porTipo = {}; banco.preguntas.forEach(q => { porTipo[q.tipo] = (porTipo[q.tipo] || 0) + 1; });
    const resumen = Object.entries(porTipo).map(([t, n]) => n + ' ' + (NOMBRES_TIPO[t] || t).toLowerCase()).join(', ');
    const previo = bancos.find(b => b.id === banco.id);
    if (!await P.confirmar((previo ? 'Ya existe el banco «' + banco.id + '»: se REEMPLAZARÁ por esta versión. ' : '') + '¿Subir «' + banco.titulo + '» con ' + banco.preguntas.length + ' preguntas (' + resumen + ')?', 'Subir', false)) return;
    try {
      const r = await rpc('profe_subir_banco', { p_banco: banco });
      await recargarDatos(); pintarGestion();
      aviso($('#msgBanco'), 'Banco «' + r.banco + '» subido: ' + r.items + ' preguntas (versión ' + r.version + ').');
    } catch (e) { if (String(e) !== 'Error: 401') aviso(msg, errorLegible(e), true); }
  }
  async function borrarBanco(id) {
    if (!await P.confirmar('¿Borrar el banco «' + id + '» con todas sus preguntas? No se puede deshacer.')) return;
    try { await rpc('profe_borrar_banco', { p_id: id }); await recargarDatos(); pintarGestion(); }
    catch (e) { if (String(e) !== 'Error: 401') aviso($('#msgBanco'), errorLegible(e), true); }
  }
  /* ---------- lista de exámenes creados, con Editar y Duplicar ---------- */
  const hechos = id => (usos ? usos[id] || 0 : 0);
  function tablaJuegos() {
    if (!juegos.length) return '';
    return '<div class="tabla-ex"><table class="datos"><thead><tr><th>Examen</th><th>ID</th><th>Preguntas</th><th>Minutos</th><th>Estado</th><th></th></tr></thead><tbody>' +
      juegos.map(j => {
        const n = hechos(j.id), r = j.reglas || {};
        return '<tr data-juego="' + esc(j.id) + '"><td>' + esc(j.titulo) + '</td><td class="num">' + esc(j.id) + '</td><td>' + (r.preguntas || '—') + '</td><td>' + (r.tiempo_min || '—') + '</td>' +
          '<td>' + (usos === null ? '—' : n ? '<span class="estado-ex e-en_curso">Ya hay ' + n + (n === 1 ? ' intento' : ' intentos') + '</span>' : 'Sin usar') + '</td>' +
          '<td><button class="btn" data-ex-editar="' + esc(j.id) + '"' + (n ? ' disabled title="Ya hay intentos: no se puede cambiar. Usa Duplicar."' : '') + '>Editar</button> ' +
          '<button class="btn" data-ex-duplicar="' + esc(j.id) + '">Duplicar</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="dato-p">Editar rellena el formulario de arriba con este examen. Solo se puede mientras nadie lo haya hecho; si ya hay intentos, usa Duplicar.</p>';
  }
  /* modo 'editar': el ID queda fijo y «Guardar cambios» sobrescribe ese examen · modo 'duplicar': mismos datos con un ID nuevo */
  function cargarEnFormulario(id, modo) {
    const j = juegos.find(x => x.id === id); if (!j || !$('#fJuego')) return;
    const r = j.reglas || {};
    $('#jId').value = modo === 'editar' ? j.id : nuevoId(j.id);
    $('#jId').readOnly = modo === 'editar';
    $('#jTitulo').value = modo === 'editar' ? j.titulo : j.titulo + ' (copia)';
    P.app.querySelectorAll('.jBanco').forEach(c => { c.checked = (j.bancos || []).includes(c.value); });
    $('#jPreg').value = r.preguntas || 20; $('#jMin').value = r.tiempo_min || 30;
    const opt = [...$('#jPen').options].find(o => Number(o.value) === Number(r.penalizacion || 0)); $('#jPen').value = opt ? opt.value : '0';
    $('#jEq').value = r.equilibrar === 'ninguno' ? 'ninguno' : 'tema';
    $('#bCrearJuego').textContent = modo === 'editar' ? 'Guardar cambios' : 'Crear examen';
    const av = $('#avisoEdicion'); av.hidden = false; av.className = 'msg-ex bien';
    av.innerHTML = (modo === 'editar' ? 'Editando «' + esc(j.titulo) + '». Cambia lo que quieras y pulsa «Guardar cambios».' : 'Copia de «' + esc(j.titulo) + '»: cambia el ID (y lo que quieras) y pulsa «Crear examen».') +
      ' <button type="button" class="btn" id="bCancelarEdicion">Cancelar</button>';
    $('#bCancelarEdicion').onclick = salirDeEdicion;
    $('#msgJuego').textContent = ''; $('#msgJuego').className = 'msg-ex';
    $('#fJuego').scrollIntoView({ behavior: 'smooth', block: 'center' });
    (modo === 'editar' ? $('#jTitulo') : $('#jId')).focus();
  }
  function salirDeEdicion() {
    $('#fJuego').reset(); $('#jId').readOnly = false; $('#bCrearJuego').textContent = 'Crear examen'; $('#avisoEdicion').hidden = true;
  }
  const nuevoId = id => { let n = id.replace(/-copia\d*$/, '') + '-copia', k = 1; while (juegos.some(x => x.id === n)) n = id.replace(/-copia\d*$/, '') + '-copia' + (++k); return n.slice(0, 60); };

  async function crearJuego() {
    const msg = $('#msgJuego'), editando = $('#jId').readOnly, seleccion = [...P.app.querySelectorAll('.jBanco:checked')].map(x => x.value);
    if (!seleccion.length) return aviso(msg, 'Elige al menos un banco.', true);
    const juego = { id: $('#jId').value.trim(), modo: 'examen', titulo: $('#jTitulo').value.trim(), bancos: seleccion,
      reglas: { preguntas: +$('#jPreg').value, tiempo_min: +$('#jMin').value, penalizacion: +$('#jPen').value, equilibrar: $('#jEq').value } };
    try {
      const r = await rpc('profe_crear_juego', { p_juego: juego });
      await recargarDatos(); pintarGestion();
      aviso($('#msgJuego'), editando ? 'Examen «' + r.juego + '» guardado: ' + r.reglas.preguntas + ' preguntas, ' + r.reglas.tiempo_min + ' minutos. Si ya estaba puesto a un grupo, sigue puesto.'
        : 'Examen «' + r.juego + '» creado: ' + r.reglas.preguntas + ' preguntas, ' + r.reglas.tiempo_min + ' minutos. Ahora ponlo a un grupo (paso 3).');
    } catch (e) { if (String(e) !== 'Error: 401') aviso(msg, errorLegible(e), true); }
  }
  async function asignar() {
    const msg = $('#msgAsignar');
    const iso = v => (v ? new Date(v).toISOString() : null);
    const conFechas = $('#aFechas').checked;          // sin marcar = sin límite de fechas (siempre abierto)
    const args = { p_juego: $('#aJuego').value, p_grupo: $('#aGrupo').value, p_desde: conFechas ? iso($('#aDesde').value) : null, p_hasta: conFechas ? iso($('#aHasta').value) : null, p_intentos: +$('#aInt').value, p_mostrar_soluciones: $('#aSol').checked };
    try {
      await rpc('profe_asignar', args);
      await recargarDatos(); pintarGestion();
      aviso($('#msgAsignar'), 'Hecho. Pasa este enlace a los alumnos: ' + enlaceExamen(args.p_juego));
    } catch (e) { if (String(e) !== 'Error: 401') aviso(msg, errorLegible(e), true); }
  }

  /* ---------- resultados de un examen ---------- */
  async function pintarResultados() {
    const id = P.f.asignacion, a = asignaciones.find(x => x.id === id);
    if (!a) { P.f.vista = 'inicio'; return P.pintar(); }
    P.app.innerHTML = '<div class="cargando">Cargando los resultados del examen…</div>';
    try { [res, est] = await Promise.all([rpc('profe_resultados', { p_asignacion: id }), rpc('profe_estadisticas_examen', { p_asignacion: id })]); }
    catch (e) { if (String(e) !== 'Error: 401') P.app.innerHTML = '<div class="vacio">No se han podido cargar los resultados (' + esc(e.message) + ').</div>'; return; }
    if (!res.ok) { P.app.innerHTML = '<div class="vacio">Esta asignación ya no existe.</div>'; return; }
    dibujarResultados();
  }
  function filas() {
    const a = res.asignacion;
    const porAl = {}; res.partidas.forEach(p => (porAl[p.alumno] = porAl[p.alumno] || []).push(p));
    return P.alumnos().filter(x => x.grupo === a.grupo && x.activo).map(al => {
      const ps = porAl[al.id] || [], ult = ps[ps.length - 1];
      return { id: al.id, num: P.numDe(al.id), nombre: P.nombreDe(al.id), ps, ult,
        estado: ult ? ult.estado : 'sin_empezar', nota: ult && ult.nota != null ? Number(ult.nota) : null, aciertos: ult ? ult.aciertos : null, total: ult ? ult.total : null,
        seg: ult ? ult.segundos : null, salidas: ult ? ult.eventos.salidas : null, fuera: ult ? ult.eventos.segundos_fuera : null, recargas: ult ? ult.eventos.recargas : null };
    });
  }
  function dibujarResultados() {
    const a = res.asignacion, fs = filas(), j = juegoDe(a.juego);
    const hechos = fs.filter(x => x.estado === 'entregada' || x.estado === 'caducada'), enCurso = fs.filter(x => x.estado === 'en_curso');
    const conSalidas = fs.filter(x => x.salidas > 0).length;
    let h = '<div class="migas"><button class="btn" id="bInicio">'+icono("volver")+' Inicio</button><button class="btn" id="bGestion2">'+icono("ajustes")+' Gestionar exámenes</button></div>' +
      '<div class="filtros"><div class="campo"><label>EXAMEN</label><div class="valor-ex"><b>' + esc(a.titulo) + '</b> · ' + esc(a.grupo) + ' · ' + esc(ROTULO[ventana(a)]) + '</div></div>' +
      '<span class="espacio"></span><button class="btn" id="bRecargarEx">'+icono("actualizar")+' Actualizar</button><button class="btn pri" id="bExcelEx">'+icono("bajar")+' Descargar para Excel</button></div>';
    h += '<div class="banda-notas ' + (a.notas_publicadas ? 'pub' : '') + '"><span>' + (a.notas_publicadas ? icono('ok') + ' Los alumnos YA ven su nota.' : icono('aviso') + ' Los alumnos todavía NO ven su nota.') + '</span>' +
      '<button class="btn ' + (a.notas_publicadas ? '' : 'pri') + '" id="bPublicar">' + (a.notas_publicadas ? 'Ocultar las notas' : 'Publicar las notas') + '</button></div>';
    h += '<div class="resumen">' +
      '<div class="regla"><span class="g">' + hechos.length + '<small style="font-size:16px;color:var(--mut)">/' + fs.length + '</small></span><p>han entregado</p></div>' +
      '<div class="regla"><span class="g">' + (hechos.length ? P.fmtNotaTxt(P.media(hechos.map(x => x.nota))) : '—') + '</span><p>nota media</p></div>' +
      '<div class="regla"><span class="g">' + enCurso.length + '</span><p>lo están haciendo</p></div>' +
      '<div class="regla"><span class="g" style="color:' + (conSalidas ? 'var(--ambar)' : 'inherit') + '">' + conSalidas + '</span><p>salieron de la pestaña</p></div>' +
      '<div class="regla"><span class="g">' + (j.reglas.tiempo_min || '—') + '<small style="font-size:16px;color:var(--mut)"> min</small></span><p>de tiempo</p></div></div>';
    h += '<div class="tabs"><button data-t="alumnos" class="' + (tab === 'alumnos' ? 'on' : '') + '">ALUMNOS</button><button data-t="preguntas" class="' + (tab === 'preguntas' ? 'on' : '') + '">PREGUNTAS</button></div><div id="vistaEx"></div>';
    P.app.innerHTML = h;
    $('#bInicio').onclick = () => { P.f.vista = 'inicio'; P.pintar(); };
    $('#bGestion2').onclick = () => { P.f.vista = 'gestion'; P.pintar(); };
    $('#bRecargarEx').onclick = () => pintarResultados();
    $('#bExcelEx').onclick = () => exportar(fs);
    $('#bPublicar').onclick = publicar;
    P.app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; dibujarResultados(); });
    if (tab === 'preguntas') vistaPreguntas(); else vistaAlumnos(fs);
  }
  async function publicar() {
    const a = res.asignacion, publicar = !a.notas_publicadas;
    const texto = publicar ? '¿Publicar las notas de «' + a.titulo + '»? Los alumnos de ' + a.grupo + ' podrán ver la suya cuando entren.' : '¿Ocultar otra vez las notas? Dejarán de verlas.';
    if (!await P.confirmar(texto, publicar ? 'Publicar' : 'Ocultar', false)) return;
    try {
      await rpc('profe_publicar_notas', { p_asignacion: a.id, p_publicar: publicar });
      const fila = asignaciones.find(x => x.id === a.id); if (fila) fila.notas_publicadas = publicar;
      a.notas_publicadas = publicar; dibujarResultados();
    } catch (e) { if (String(e) !== 'Error: 401') alert('No se ha podido cambiar: ' + errorLegible(e)); }
  }

  const COLS = [['num', 'Nº'], ['nombre', 'Nombre'], ['estado', 'Estado'], ['nota', 'Nota'], ['aciertos', 'Aciertos'], ['seg', 'Tiempo'], ['salidas', 'Salidas'], ['fuera', 'Fuera (s)'], ['recargas', 'Recargas']];
  function vistaAlumnos(fs) {
    const c = orden.col, s = orden.asc ? 1 : -1;
    fs.sort((x, y) => { let p = x[c], q = y[c]; if (p == null || p === '') return 1; if (q == null || q === '') return -1; return (typeof p === 'string' ? p.localeCompare(q, 'es') : p - q) * s; });
    const hayNombres = fs.some(x => x.nombre);
    const nota = x => x.nota == null ? '—' : P.fmtNota(x.nota);
    const estado = x => '<span class="estado-ex e-' + x.estado + '">' + esc(x.estado === 'sin_empezar' ? 'Sin empezar' : ESTADO[x.estado]) + (x.ps.length > 1 ? ' · intento ' + x.ult.intento : '') + '</span>';
    const salidas = x => x.salidas ? '<span class="salidas">' + x.salidas + '</span>' : (x.ult ? '0' : '—');
    let h = '<div class="tabla-wrap"><table class="datos"><thead><tr>' +
      COLS.filter(([k]) => hayNombres || k !== 'nombre').map(([k, t]) => '<th data-c="' + k + '" class="' + (k === c ? 'orden' + (orden.asc ? ' asc' : '') : '') + '">' + t + '</th>').join('') + '</tr></thead><tbody>' +
      fs.map(x => '<tr data-id="' + esc(x.id) + '" class="' + (x.ult ? '' : 'sin') + '"><td class="num">' + esc(x.num) + '</td>' + (hayNombres ? '<td>' + (esc(x.nombre) || '<span style="color:var(--mut)">¿?</span>') + '</td>' : '') +
        '<td>' + estado(x) + '</td><td>' + nota(x) + '</td><td>' + (x.ult && x.total != null ? x.aciertos + '/' + x.total : '—') + '</td><td>' + (x.seg == null ? '—' : P.fmtSeg(x.seg)) + '</td><td>' + salidas(x) + '</td><td>' + (x.fuera ? x.fuera : (x.ult ? '0' : '—')) + '</td><td>' + (x.recargas == null ? '—' : x.recargas) + '</td></tr>').join('') +
      '</tbody></table></div>';
    h += '<div class="lista-movil">' + fs.map(x => '<button class="al-card' + (x.ult ? '' : ' sin') + '" data-id="' + esc(x.id) + '"><span class="num">' + esc(x.num) + '</span><span class="al-nom">' + (esc(x.nombre) || 'Nº ' + esc(x.num)) +
      '<small>' + (x.estado === 'sin_empezar' ? 'sin empezar' : ESTADO[x.estado].toLowerCase()) + (x.salidas ? ' · salió ' + x.salidas + (x.salidas === 1 ? ' vez' : ' veces') : '') + '</small></span>' + (x.nota == null ? '' : P.fmtNota(x.nota)) + '</button>').join('') + '</div>';
    h += '<p class="dato-p">Pulsa un alumno para ver su examen pregunta a pregunta, sus salidas de pestaña, o anular su intento.</p>';
    $('#vistaEx').innerHTML = h;
    $('#vistaEx').querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.c; orden = { col: k, asc: orden.col === k ? !orden.asc : (k === 'num' || k === 'nombre') }; dibujarResultados(); });
    $('#vistaEx').querySelectorAll('tbody tr, .al-card').forEach(el => el.onclick = () => abrirDetalle(el.dataset.id));
  }

  function abrirDetalle(id) {
    const x = filas().find(r => r.id === id); if (!x) return;
    const enun = Object.fromEntries((est.preguntas || []).map(q => [q.clave, q.enun]));
    const cuerpo = !x.ps.length ? '<div class="vacio">Todavía no ha empezado este examen.</div>' :
      [...x.ps].reverse().map(p => {
        const ev = p.eventos;
        return '<div class="intento" data-partida="' + esc(p.partida) + '"><div class="cab-i">' + (p.nota != null ? P.fmtNota(Number(p.nota)) : '<span class="estado-ex e-en_curso">En curso</span>') +
          '<span class="fecha">Intento ' + p.intento + ' · ' + esc(ESTADO[p.estado]) + ' · ' + esc(P.fmtFecha(p.terminada || p.empezada)) + '</span>' +
          '<span class="dato-p">' + (p.total != null ? p.aciertos + '/' + p.total + ' bien · ' : '') + (p.segundos != null ? P.fmtSeg(p.segundos) : 'sin terminar') + '</span>' +
          '<button class="btn peligro" data-anular="' + esc(p.partida) + '">Anular intento</button></div>' +
          '<div class="eventos-ex ' + (ev.salidas ? 'alerta' : '') + '">' + (ev.salidas || ev.recargas || ev.sin_red
            ? (ev.salidas ? '⚠ Salió de la pestaña ' + ev.salidas + (ev.salidas === 1 ? ' vez' : ' veces') + ' (' + ev.segundos_fuera + ' s fuera). ' : '') + (ev.recargas ? 'Recargó la página ' + ev.recargas + '. ' : '') + (ev.sin_red ? 'Perdió la conexión ' + ev.sin_red + '.' : '')
            : 'Sin salidas de pestaña ni incidencias.') + '</div>' +
          '<div class="cronologia" data-crono="' + esc(p.partida) + '"></div>' +
          '<div class="mapa">' + p.respuestas.map((r, k) => '<button class="' + (!r.respondida ? 'blanco' : r.ok ? 'ok' : 'mal') + '" title="' + esc(enun[r.id] || r.id) + '">' + (k + 1) + '</button>').join('') + '</div>' +
          '<p class="leyenda-mapa">Verde = bien · rojo = mal · gris = en blanco. Pulsa para leer la pregunta.</p><div class="ver-p" hidden></div></div>';
      }).join('');
    const cuerpoEl = P.abrirModal('Nº ' + x.num + (x.nombre ? ' · ' + x.nombre.toUpperCase() : ''), cuerpo);
    cuerpoEl.querySelectorAll('.mapa button').forEach(b => b.onclick = () => {
      const caja = b.closest('.intento'), p = x.ps.find(z => z.partida === caja.dataset.partida), r = p.respuestas[[...caja.querySelectorAll('.mapa button')].indexOf(b)];
      caja.querySelectorAll('.mapa button').forEach(o => o.classList.toggle('on', o === b));
      const ver = caja.querySelector('.ver-p'); ver.hidden = false;
      const cab = '<b>' + esc(enun[r.id] || r.id) + '</b><div class="dato-p">' + (r.respondida ? (r.ok ? 'Acertó' : 'Falló') + (r.ms ? ' · tardó ' + P.fmtSeg(r.ms / 1000) : '') : 'La dejó en blanco') + '</div>';
      ver.innerHTML = cab;
      // Lo que puso el alumno, la respuesta correcta y el porqué: se leen del banco (el profesor tiene permiso)
      datosPregunta(r.id).then(d => {
        if (!d || !ver.isConnected || !b.classList.contains('on')) return;
        ver.innerHTML = cab + '<div class="resp-ex"><div><span class="et">CONTESTÓ</span> ' + (r.respondida ? esc(loQuePuso(d, r.dada)) : '<i>nada</i>') + '</div>' +
          '<div><span class="et">CORRECTA</span> ' + esc(laCorrecta(d)) + '</div>' + (d.sol ? '<div class="dato-p">' + esc(d.sol) + '</div>' : '') + '</div>';
      });
    });
    cuerpoEl.querySelectorAll('[data-anular]').forEach(b => b.onclick = () => anular(b.dataset.anular, x));
    cuerpoEl.querySelectorAll('[data-crono]').forEach(el => cargarCronologia(el));
  }

  /* La pregunta tal como está en el banco (con soluciones), para ver lo que contestó el alumno. Se guarda en memoria para no pedirla dos veces. */
  const cachePreguntas = {};
  async function datosPregunta(clave) {
    if (clave in cachePreguntas) return cachePreguntas[clave];
    const i = String(clave).indexOf('/');
    if (i < 1) return null;
    try {
      const f = await P.api('items?banco=eq.' + encodeURIComponent(clave.slice(0, i)) + '&id=eq.' + encodeURIComponent(clave.slice(i + 1)) + '&select=datos');
      return (cachePreguntas[clave] = f && f[0] ? f[0].datos : null);
    } catch (e) { return null; }
  }
  // dada = lo guardado: para opción múltiple es el índice ORIGINAL de la opción (no la posición en la que se la barajó al alumno)
  const loQuePuso = (d, dada) => d.tipo === 'opcion_multiple' ? String((d.ops || [])[dada] ?? dada)
    : d.tipo === 'verdadero_falso' ? (dada === true ? 'Verdadero' : dada === false ? 'Falso' : String(dada)) : String(dada);
  const laCorrecta = d => d.tipo === 'opcion_multiple' ? String((d.ops || [])[d.ok])
    : d.tipo === 'verdadero_falso' ? (d.ok ? 'Verdadero' : 'Falso')
    : d.tipo === 'numerica' ? String(d.valor).replace('.', ',') + (d.unidad ? ' ' + d.unidad : '') + (d.tolerancia ? ' (± ' + String(d.tolerancia).replace('.', ',') + ')' : '')
    : (d.aceptadas || []).join('  ·  ');

  /* Cronología de incidencias de una partida (salidas, vueltas, recargas, cortes de red), con la hora de cada una. Se lee de la tabla eventos: el profesor tiene permiso. */
  const CRONO = { salida: 'Salió de la pestaña', vuelta: 'Volvió', recarga: 'Recargó o reabrió la página', sin_red: 'Recuperó la conexión', otro: 'Otra incidencia' };
  async function cargarCronologia(el) {
    let filas;
    try { filas = await P.api('eventos?partida=eq.' + encodeURIComponent(el.dataset.crono) + '&select=tipo,momento,detalle&order=momento.asc&limit=500'); }
    catch (e) { return; }                                   // sin cronología no pasa nada: los totales ya están arriba
    if (!filas || !filas.length) return;
    el.innerHTML = '<details><summary>Ver cronología (' + filas.length + ' incidencias)</summary><ol class="linea-eventos">' + filas.map(f => {
      const seg = f.detalle && Number.isFinite(+f.detalle.segundos) ? +f.detalle.segundos : null;
      const hora = fecha(f.momento).toLocaleTimeString('es-ES');
      const foco = f.tipo === 'otro' && f.detalle && f.detalle.foco;     // foco perdido: la ventana seguía visible pero pulsó en otra
      const texto = foco ? (foco === 'perdido' ? 'Pulsó fuera de la ventana del examen' : 'Volvió a la ventana del examen' + (seg != null ? ' (' + seg + ' s fuera de foco)' : ''))
        : (CRONO[f.tipo] || f.tipo) + (seg != null ? (f.tipo === 'vuelta' ? ' (' + seg + ' s fuera)' : f.tipo === 'sin_red' ? ' (' + seg + ' s sin conexión)' : '') : '');
      return '<li class="ev-' + esc(foco ? 'foco' : f.tipo) + '"><time>' + esc(hora) + '</time> ' + esc(texto) + '</li>';
    }).join('') + '</ol></details>';
    const nFoco = filas.filter(f => f.tipo === 'otro' && f.detalle && f.detalle.foco === 'perdido').length;
    if (nFoco) el.insertAdjacentHTML('afterbegin', '<p class="eventos-ex alerta">⚠ Pulsó fuera de la ventana del examen ' + nFoco + (nFoco === 1 ? ' vez' : ' veces') + ' (otra ventana a la vez).</p>');
  }
  async function anular(partida, x) {
    const p = x.ps.find(z => z.partida === partida);
    if (!await P.confirmar('¿Anular el intento ' + p.intento + ' del nº ' + x.num + (x.nombre ? ', ' + x.nombre : '') + '? Se borran sus respuestas y, si la asignación se lo permite, podrá empezar de nuevo. No se puede deshacer.', 'Anular')) return;
    try { await rpc('profe_borrar_partida', { p_id: partida }); P.cerrarModal(); await pintarResultados(); }
    catch (e) { if (String(e) !== 'Error: 401') alert('No se ha podido anular: ' + errorLegible(e)); }
  }

  function vistaPreguntas() {
    const qs = est.preguntas || [];
    let h = !qs.length ? '<div class="vacio">Todavía no hay exámenes entregados: aquí saldrán las preguntas que más se fallan.</div>' : '';
    h += '<div class="preguntas">' + qs.map(q => {
      const pct = Number(q.pct_fallo), rep = q.reparto || [];
      const peor = rep.filter(o => !o.correcta).sort((a, b) => b.veces - a.veces)[0];
      return '<div class="pfila"><div><div class="cab-p"><span class="idp">' + esc(q.clave.split('/').pop().toUpperCase()) + '</span>' + chip(q.tipo) + (q.tema ? '<span class="act">' + esc(q.tema) + '</span>' : '') + '</div>' +
        '<div class="enun-p">' + esc(q.enun) + '</div>' +
        (peor && peor.veces ? '<div class="trampa-mas"><b>LA RESPUESTA EQUIVOCADA MÁS ELEGIDA · ' + peor.veces + ' VECES</b><code>' + esc(peor.texto) + '</code></div>' : '') + '</div>' +
        '<div class="lado"><div class="pct" style="color:' + (pct >= 50 ? 'var(--rojo)' : pct >= 25 ? 'var(--ambar)' : 'var(--verde)') + '">' + Math.round(pct) + '%<small>NO ACERTADA</small></div>' +
        '<div class="barra-fallo"><i style="width:' + pct + '%"></i></div>' +
        '<div class="dato-p">' + q.aciertos + ' bien · ' + q.fallos + ' mal · ' + q.blancos + ' en blanco (de ' + q.n + ')</div>' +
        (q.ms_tipico ? '<div class="dato-p">Tiempo típico: ' + P.fmtSeg(q.ms_tipico / 1000) + '</div>' : '') +
        (rep.length ? '<div class="reparto">' + rep.map((o, i) => '<div class="' + (o.correcta ? 'ok' : '') + '" title="' + esc(o.texto) + '"><span class="l">' + 'ABCDEF'[i] + (o.correcta ? '✓' : '') + '</span><span class="barrita"><i style="width:' + (Math.max(...rep.map(z => z.veces), 1) ? o.veces / Math.max(...rep.map(z => z.veces), 1) * 100 : 0) + '%"></i></span><b>' + o.veces + '</b></div>').join('') + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
    $('#vistaEx').innerHTML = h;
  }

  function exportar(fs) {
    const a = res.asignacion;
    fs = [...fs].sort((x, y) => x.num.localeCompare(y.num, 'es', { numeric: true }));
    const cab = ['Nº', 'Nombre', 'Estado', 'Intento', 'Nota', 'Aciertos', 'Total', 'Tiempo', 'Salidas de pestaña', 'Segundos fuera', 'Recargas', 'Sin red'];
    const filasCSV = fs.map(x => [x.num, x.nombre, x.estado === 'sin_empezar' ? 'Sin empezar' : ESTADO[x.estado], x.ult ? x.ult.intento : '', P.fmtNotaTxt(x.nota), x.aciertos == null ? '' : x.aciertos, x.total == null ? '' : x.total,
      x.seg == null ? '' : P.fmtSeg(x.seg), x.salidas == null ? '' : x.salidas, x.fuera == null ? '' : x.fuera, x.recargas == null ? '' : x.recargas, x.ult ? x.ult.eventos.sin_red : '']);
    const csv = '﻿' + [cab, ...filasCSV].map(r => r.map(v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';')).join('\r\n');
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    el.download = a.grupo + '_' + a.juego + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  }

  return { cargar, tarjetas, enlazarInicio, pintarGestion, pintarResultados };
}
