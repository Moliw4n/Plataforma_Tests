/* Panel del profesor · RESULTADOS DEL DIRECTO (módulo de panel.js).
   Las salas ya jugadas: clasificación con puntos, qué preguntas se fallaron, resultados por criterio y quién no entró.
   Todo se LEE de las tablas directo_* y items por REST (el profesor tiene permiso de lectura: supabase/09_directo.sql), así que no hace falta
   ningún SQL nuevo. Para borrar una sala usa profe_directo_borrar. P = lo que le presta panel.js. */
import { icono } from './nucleo/iconos.js';

export function crearDirectos(P) {
  const { esc } = P;
  const $ = s => document.querySelector(s);
  let salas = [], det = null, tab = 'alumnos';
  const enc = encodeURIComponent;
  const ESTADO = { espera: 'Sin empezar', pregunta: 'En curso', resultado: 'En curso', terminada: 'Terminada' };
  const rpc = (fn, args) => P.api('rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });
  const mediana = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const seg1 = ms => ms == null ? '—' : (ms / 1000).toFixed(1).replace('.', ',') + ' s';
  const pct = (a, b) => b ? Math.round(a / b * 100) : null;
  const colorFallo = p => p >= 50 ? 'var(--rojo)' : p >= 25 ? 'var(--ambar)' : 'var(--verde)';

  /* ---------- datos ---------- */
  async function cargar() {
    try {
      salas = await P.api('directo_sesiones?select=id,sala,grupo,titulo,tiempo_s,lectura_s,estado,actual,creada,terminada&order=creada.desc&limit=100');
      return true;
    } catch (e) {
      if (String(e) === 'Error: 401') throw e;
      return false;              // aún no se ha ejecutado el SQL 09 en esta base: el panel sigue como antes
    }
  }

  /* ---------- inicio: tarjetas de las salas de un grupo ---------- */
  function tarjetas(grupoId) {
    const mias = salas.filter(s => s.grupo === grupoId && s.actual >= 0);   // las salas que no llegaron a empezar no cuentan
    if (!mias.length) return '';
    return '<div class="examenes-grupo directos-grupo"><h3>Directos</h3>' + mias.slice(0, 5).map(s =>
      '<div class="test-card examen-card"><div class="tc-tit"><b>' + esc(s.titulo) + '</b><span class="dato-p">' + esc(ESTADO[s.estado]) + ' · ' + esc(P.fmtFecha(s.creada)) +
        ' · sala ' + esc(s.sala) + '</span></div>' +
        '<div class="tc-acc"><button class="btn pri" data-di-res="' + esc(s.id) + '">Ver resultados</button></div></div>').join('') +
      (mias.length > 5 ? '<p class="dato-p">Y ' + (mias.length - 5) + ' más antiguos.</p>' : '') + '</div>';
  }
  function enlazarInicio() {
    P.app.querySelectorAll('[data-di-res]').forEach(b => b.onclick = () => { P.f.sesion = b.dataset.diRes; P.f.vista = 'directo'; tab = 'alumnos'; P.pintar(); window.scrollTo({ top: 0 }); });
  }

  /* ---------- resultados de una sala ---------- */
  async function pintarResultados() {
    const s = salas.find(x => x.id === P.f.sesion);
    if (!s) { P.f.vista = 'inicio'; return P.pintar(); }
    P.app.innerHTML = '<div class="cargando">Cargando los resultados del directo…</div>';
    try {
      const [[full], parts, resp] = await Promise.all([
        P.api('directo_sesiones?id=eq.' + enc(s.id) + '&select=preguntas'),
        P.api('directo_participantes?sesion=eq.' + enc(s.id) + '&select=alumno,apodo,puntos,aciertos&limit=1000'),
        P.api('directo_respuestas?sesion=eq.' + enc(s.id) + '&select=alumno,pregunta,dada,ok,ms,puntos&limit=10000')
      ]);
      const lista = (full && full.preguntas) || [];
      const bancos = [...new Set(lista.map(q => q.banco))];
      const its = {};
      await Promise.all(bancos.map(async b => {
        (await P.api('items?banco=eq.' + enc(b) + '&select=id,tipo,tema,criterio,datos')).forEach(i => { its[b + '/' + i.id] = i; });
      }));
      det = calcular(s, lista, its, parts, resp);
    } catch (e) {
      if (String(e) !== 'Error: 401') P.app.innerHTML = '<div class="vacio">No se han podido cargar los resultados (' + esc(e.message) + ').</div>';
      return;
    }
    dibujar();
  }

  /* Pasa lo leído a las cuentas que se enseñan */
  function calcular(s, lista, its, parts, resp) {
    // Preguntas que llegaron a salir: hasta la actual (si la sala sigue en «pregunta», la actual aún no se ha cerrado, pero ya cuenta)
    const jugadas = Math.min(lista.length, s.estado === 'espera' ? 0 : s.actual + 1);
    const preguntas = lista.slice(0, jugadas).map((q, n) => {
      const it = its[q.banco + '/' + q.id], d = (it && it.datos) || {};
      const rs = resp.filter(r => r.pregunta === n);
      return { n, tipo: it ? it.tipo : d.tipo, tema: it && it.tema, criterio: it && it.criterio, enun: d.enun || q.id, datos: d, rs,
               aciertos: rs.filter(r => r.ok).length, ms: mediana(rs.filter(r => r.ms != null).map(r => r.ms)) };
    });
    const jug = parts.map(p => {
      const mias = resp.filter(r => r.alumno === p.alumno && r.pregunta < jugadas);
      return { alumno: p.alumno, apodo: p.apodo, puntos: p.puntos, aciertos: p.aciertos, contestadas: mias.length,
               sin: jugadas - mias.length, ms: P.media(mias.filter(r => r.ms != null).map(r => r.ms)), mias };
    }).sort((a, b) => b.puntos - a.puntos || b.aciertos - a.aciertos || String(a.apodo).localeCompare(String(b.apodo), 'es'));
    jug.forEach((j, i) => { j.pos = i > 0 && jug[i - 1].puntos === j.puntos ? jug[i - 1].pos : i + 1; });
    const entraron = new Set(parts.map(p => p.alumno));
    const faltan = P.alumnos().filter(a => a.grupo === s.grupo && a.activo && !entraron.has(a.id));
    const porCriterio = {};
    preguntas.forEach(q => { const c = q.criterio || '—'; const o = (porCriterio[c] = porCriterio[c] || { criterio: c, preguntas: 0, bien: 0, posibles: 0 }); o.preguntas++; o.bien += q.aciertos; o.posibles += jug.length; });
    return { s, preguntas, jug, faltan, jugadas, total: lista.length, criterios: Object.values(porCriterio).sort((a, b) => String(a.criterio).localeCompare(String(b.criterio), 'es', { numeric: true })) };
  }

  const nombre = id => P.nombreDe(id);
  function dibujar() {
    const { s, jug, faltan, jugadas, total, preguntas } = det;
    const aciertoMedio = jug.length && jugadas ? pct(jug.reduce((t, j) => t + j.aciertos, 0), jug.length * jugadas) : null;
    let h = '<div class="migas"><button class="btn" id="bInicio">' + icono('volver') + ' Inicio</button></div>' +
      '<div class="filtros"><div class="campo"><label>DIRECTO</label><div class="valor-ex"><b>' + esc(s.titulo) + '</b> · ' + esc(s.grupo) + ' · ' + esc(P.fmtFecha(s.creada)) + ' · sala ' + esc(s.sala) + ' · ' + esc(ESTADO[s.estado]) + '</div></div>' +
      '<span class="espacio"></span><button class="btn" id="bRecargarDi">' + icono('actualizar') + ' Actualizar</button>' +
      '<button class="btn pri" id="bExcelDi">' + icono('bajar') + ' Descargar para Excel</button>' +
      '<button class="btn peligro" id="bBorrarDi">Borrar sala</button></div>';
    h += '<div class="resumen">' +
      '<div class="regla"><span class="g">' + jug.length + '</span><p>jugaron</p></div>' +
      '<div class="regla"><span class="g" style="color:' + (faltan.length ? 'var(--ambar)' : 'inherit') + '">' + faltan.length + '</span><p>no entraron</p></div>' +
      '<div class="regla"><span class="g">' + jugadas + '<small style="font-size:16px;color:var(--mut)">/' + total + '</small></span><p>preguntas jugadas</p></div>' +
      '<div class="regla"><span class="g">' + (aciertoMedio == null ? '—' : aciertoMedio + '<small style="font-size:16px;color:var(--mut)"> %</small>') + '</span><p>de acierto medio</p></div></div>';
    h += '<div class="tabs">' + [['alumnos', 'CLASIFICACIÓN'], ['preguntas', 'PREGUNTAS'], ['criterios', 'CRITERIOS']].map(([k, t]) => '<button data-t="' + k + '" class="' + (tab === k ? 'on' : '') + '">' + t + '</button>').join('') + '</div><div id="vistaDi"></div>';
    P.app.innerHTML = h;
    $('#bInicio').onclick = () => { P.f.vista = 'inicio'; P.pintar(); };
    $('#bRecargarDi').onclick = () => pintarResultados();
    $('#bExcelDi').onclick = exportar;
    $('#bBorrarDi').onclick = borrar;
    P.app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; dibujar(); });
    if (tab === 'preguntas') vistaPreguntas(); else if (tab === 'criterios') vistaCriterios(); else vistaAlumnos();
  }

  function vistaAlumnos() {
    const { jug, faltan, jugadas } = det;
    let h = !jug.length ? '<div class="vacio">Nadie entró en esta sala.</div>' :
      '<div class="tabla-ex"><table class="datos"><thead><tr><th>Pos.</th><th>Apodo</th><th>Nº</th><th>Nombre</th><th>Puntos</th><th>Aciertos</th><th>Tiempo medio</th><th>Sin contestar</th></tr></thead><tbody>' +
      jug.map(j => '<tr class="fila-di" data-al="' + esc(j.alumno) + '" tabindex="0"><td class="num">' + j.pos + '</td><td><b>' + esc(j.apodo) + '</b></td><td class="num">' + esc(P.numDe(j.alumno)) + '</td><td>' + esc(nombre(j.alumno)) + '</td>' +
        '<td class="num"><b>' + j.puntos + '</b></td><td>' + j.aciertos + '/' + jugadas + '</td><td>' + seg1(j.ms) + '</td><td>' + (j.sin ? '<span class="salidas">' + j.sin + '</span>' : '0') + '</td></tr>').join('') +
      '</tbody></table></div><p class="dato-p">Pulsa un alumno para ver qué contestó en cada pregunta.</p>';
    if (faltan.length) h += '<div class="faltan-di"><h3>No entraron (' + faltan.length + ')</h3><p class="dato-p">' +
      faltan.map(a => esc(P.numDe(a.id) + (nombre(a.id) ? ' · ' + nombre(a.id) : ''))).join(' &nbsp;|&nbsp; ') + '</p></div>';
    $('#vistaDi').innerHTML = h;
    P.app.querySelectorAll('.fila-di').forEach(tr => { tr.onclick = () => abrirDetalle(tr.dataset.al); tr.onkeydown = e => { if (e.key === 'Enter') abrirDetalle(tr.dataset.al); }; });
  }

  const loQuePuso = (d, dada) => d.tipo === 'opcion_multiple' ? String((d.ops || [])[dada] ?? dada) : d.tipo === 'verdadero_falso' ? (dada ? 'Verdadero' : 'Falso') : String(dada);
  const laCorrecta = d => d.tipo === 'opcion_multiple' ? String((d.ops || [])[d.ok] ?? d.ok) : d.tipo === 'verdadero_falso' ? (d.ok ? 'Verdadero' : 'Falso') : '';
  function abrirDetalle(alumno) {
    const j = det.jug.find(x => x.alumno === alumno); if (!j) return;
    const filas = det.preguntas.map(q => {
      const r = j.mias.find(x => x.pregunta === q.n);
      const estado = !r ? 'blanco' : r.ok ? 'ok' : 'mal';
      return '<div class="pfila"><div><div class="cab-p"><span class="idp">' + (q.n + 1) + '</span>' + (q.criterio ? '<span class="act">' + esc(q.criterio) + '</span>' : '') + '</div>' +
        '<div class="enun-p">' + esc(q.enun) + '</div>' +
        '<div class="resp-ex"><div><span class="et">CONTESTÓ</span> ' + (r ? esc(loQuePuso(q.datos, r.dada)) : '<i>nada (no contestó a tiempo)</i>') + '</div>' +
        '<div><span class="et">CORRECTA</span> ' + esc(laCorrecta(q.datos)) + '</div></div></div>' +
        '<div class="lado"><div class="pct" style="color:' + (estado === 'ok' ? 'var(--verde)' : estado === 'mal' ? 'var(--rojo)' : 'var(--mut)') + '">' + (r ? r.puntos : 0) + '<small>' + (estado === 'ok' ? 'PUNTOS · BIEN' : estado === 'mal' ? 'MAL' : 'SIN CONTESTAR') + '</small></div>' +
        (r && r.ms != null ? '<div class="dato-p">Tardó ' + seg1(r.ms) + '</div>' : '') + '</div></div>';
    }).join('');
    P.abrirModal('Nº ' + P.numDe(alumno) + (nombre(alumno) ? ' · ' + nombre(alumno).toUpperCase() : '') + ' · «' + j.apodo + '»',
      '<p class="dato-p">' + j.puntos + ' puntos · ' + j.aciertos + '/' + det.jugadas + ' bien · puesto ' + j.pos + ' de ' + det.jug.length + '</p><div class="preguntas">' + filas + '</div>');
  }

  function vistaPreguntas() {
    const { preguntas, jug } = det;
    if (!preguntas.length) { $('#vistaDi').innerHTML = '<div class="vacio">Todavía no salió ninguna pregunta.</div>'; return; }
    const n = jug.length;
    const orden = [...preguntas].sort((a, b) => (a.aciertos / (n || 1)) - (b.aciertos / (n || 1)) || a.n - b.n);   // la más fallada, primero
    $('#vistaDi').innerHTML = '<div class="preguntas">' + orden.map(q => {
      const fallo = n ? 100 - pct(q.aciertos, n) : 0;
      const rep = reparto(q);
      const peor = rep.filter(o => !o.correcta).sort((a, b) => b.veces - a.veces)[0];
      const mal = q.rs.filter(r => !r.ok).length, blancos = n - q.rs.length;
      return '<div class="pfila"><div><div class="cab-p"><span class="idp">P' + (q.n + 1) + '</span>' + (q.criterio ? '<span class="act">' + esc(q.criterio) + '</span>' : '') + (q.tema ? '<span class="act">' + esc(q.tema) + '</span>' : '') + '</div>' +
        '<div class="enun-p">' + esc(q.enun) + '</div>' +
        (peor && peor.veces ? '<div class="trampa-mas"><b>LA RESPUESTA EQUIVOCADA MÁS ELEGIDA · ' + peor.veces + ' VECES</b><code>' + esc(peor.texto) + '</code></div>' : '') +
        (q.datos.sol ? '<div class="dato-p">' + esc(q.datos.sol) + '</div>' : '') + '</div>' +
        '<div class="lado"><div class="pct" style="color:' + colorFallo(fallo) + '">' + fallo + '%<small>NO ACERTADA</small></div><div class="barra-fallo"><i style="width:' + fallo + '%"></i></div>' +
        '<div class="dato-p">' + q.aciertos + ' bien · ' + mal + ' mal · ' + blancos + ' sin contestar (de ' + n + ')</div>' +
        (q.ms ? '<div class="dato-p">Tiempo típico: ' + seg1(q.ms) + '</div>' : '') +
        (rep.length ? '<div class="reparto">' + rep.map((o, i) => '<div class="' + (o.correcta ? 'ok' : '') + '" title="' + esc(o.texto) + '"><span class="l">' + 'ABCDEF'[i] + (o.correcta ? '✓' : '') + '</span><span class="v">' + o.veces + '</span></div>').join('') + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  /* Cuántas veces se eligió cada opción (en opción múltiple y verdadero/falso las respuestas guardan el índice de la opción original) */
  function reparto(q) {
    const d = q.datos;
    const opciones = d.tipo === 'opcion_multiple' ? (d.ops || []).map((t, i) => ({ texto: t, valor: i, correcta: i === d.ok }))
      : d.tipo === 'verdadero_falso' ? [{ texto: 'Verdadero', valor: true, correcta: d.ok === true }, { texto: 'Falso', valor: false, correcta: d.ok === false }] : [];
    return opciones.map(o => ({ texto: o.texto, correcta: o.correcta, veces: q.rs.filter(r => r.dada === o.valor).length }));
  }

  function vistaCriterios() {
    const { criterios, jug } = det;
    const hay = criterios.some(c => c.criterio !== '—');
    $('#vistaDi').innerHTML = !criterios.length ? '<div class="vacio">Todavía no salió ninguna pregunta.</div>' :
      (hay ? '' : '<p class="dato-p">Las preguntas de este banco no llevan criterio de evaluación: todas salen juntas.</p>') +
      '<div class="tabla-ex"><table class="datos"><thead><tr><th>Criterio</th><th>Preguntas</th><th>Acierto de la clase</th></tr></thead><tbody>' +
      criterios.map(c => { const p = pct(c.bien, c.posibles); return '<tr><td class="num">' + esc(c.criterio) + '</td><td>' + c.preguntas + '</td><td><b style="color:' + (p == null ? 'inherit' : colorFallo(100 - p)) + '">' + (p == null ? '—' : p + ' %') + '</b> <span class="dato-p">(' + c.bien + ' de ' + c.posibles + ' respuestas)</span></td></tr>'; }).join('') +
      '</tbody></table></div><p class="dato-p">Cuenta como fallo no contestar. Jugaron ' + jug.length + ' alumnos.</p>';
  }

  /* ---------- acciones ---------- */
  async function borrar() {
    const { s, jug } = det;
    if (!await P.confirmar('¿Borrar la sala «' + s.titulo + '» con sus ' + jug.length + ' jugadores y todas sus respuestas? No se puede deshacer.', 'Borrar')) return;
    try {
      await rpc('profe_directo_borrar', { p_sesion: s.id });
      salas = salas.filter(x => x.id !== s.id);
      P.f.vista = 'inicio'; P.pintar();
    } catch (e) { if (String(e) !== 'Error: 401') alert('No se ha podido borrar la sala: ' + (e && e.detalle ? e.detalle : e.message)); }
  }
  function exportar() {
    const { s, jug, preguntas, jugadas } = det;
    const cab = ['Pos.', 'Apodo', 'Nº', 'Nombre', 'Puntos', 'Aciertos', 'Total', 'Tiempo medio (s)', 'Sin contestar', ...preguntas.map(q => 'P' + (q.n + 1) + (q.criterio ? ' (' + q.criterio + ')' : ''))];
    const filas = jug.map(j => [j.pos, j.apodo, P.numDe(j.alumno), nombre(j.alumno), j.puntos, j.aciertos, jugadas, j.ms == null ? '' : (j.ms / 1000).toFixed(1).replace('.', ','), j.sin,
      ...preguntas.map(q => { const r = j.mias.find(x => x.pregunta === q.n); return !r ? '' : r.ok ? 1 : 0; })]);
    const csv = '﻿' + [cab, ...filas].map(r => r.map(v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';')).join('\r\n');
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    el.download = 'directo_' + s.grupo + '_' + s.sala + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  }

  return { cargar, tarjetas, enlazarInicio, pintarResultados };
}
