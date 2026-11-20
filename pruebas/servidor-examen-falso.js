/* Servidor FALSO del examen, para las pruebas de la web (Playwright). Imita las funciones de supabase/07_examen.sql
   con LA MISMA FORMA de respuestas. Para que no se desvíe del real, pruebas/contrato-examen.test.js ejecuta el mismo
   guion contra este y contra el SQL de verdad y compara la forma de cada respuesta.
   Es determinista a propósito (sin barajar las preguntas; las opciones de opción múltiple salen al revés) para que las pruebas
   de pantalla sean estables, pero SÍ comprueba la posición→opción original como el SQL.
   Ajustes para las pruebas: this.red = false (corta la red), this.desfase (ms de reloj), this.latencia (ms). */
const path = require('path');
const { pathToFileURL } = require('url');
const RAIZ = path.join(__dirname, '..');

const it = (id, extra) => ({ id, enun: 'Enunciado ' + id, sol: 'SOLUCION-' + id, trampa: 'TRAMPA-' + id, ...extra });
function bancoDePrueba() {
  const preguntas = [];
  ['t1', 't2', 't3'].forEach((tema, ti) => {
    preguntas.push(it(tema + 'mc', { tipo: 'opcion_multiple', ops: ['A ' + tema, 'B ' + tema, 'C ' + tema, 'D ' + tema], ok: 1, tema, salida: 'SALIDA-SECRETA' }));
    preguntas.push(it(tema + 'fija', { tipo: 'opcion_multiple', ops: ['x1', 'x2', 'x3', 'Ninguna de las anteriores'], ok: 3, fija_ultima: true, tema }));
    preguntas.push(it(tema + 'vf', { tipo: 'verdadero_falso', ok: ti % 2 === 0, tema }));
    preguntas.push(ti % 2 === 0 ? it(tema + 'n', { tipo: 'numerica', valor: 9182736.5 + ti, tolerancia: 0.5, unidad: 'u', tema })
                                : it(tema + 'c', { tipo: 'respuesta_corta', aceptadas: ['canarioXYZ' + ti, 'otra' + ti], pista: 'una pista', tema }));
  });
  return { formato: 2, id: 'grande', titulo: 'Banco grande', materia: 'TDA I', preguntas };
}

async function crearServidorFalso(opciones = {}) {
  const R = await import(pathToFileURL(path.join(RAIZ, 'js', 'nucleo', 'preguntas', 'index.js')).href);
  const banco = bancoDePrueba();
  const S = {
    banco, red: true, desfase: 0, latencia: 0, llamadas: [], eventos: [],
    juego: { id: 'ex', titulo: 'Examen de prueba', modo: 'examen', reglas: { preguntas: 6, tiempo_min: 20, penalizacion: 0, equilibrar: 'tema', ...(opciones.reglas || {}) } },
    asignacion: { id: 1, grupo: 'TDA2', desde: null, hasta: null, intentos: 1, mostrar_soluciones: false, notas_publicadas: false, ...(opciones.asignacion || {}) },
    alumnos: { ABC123: { id: 'TDA2-07', grupo: 'TDA2' }, AAA222: { id: 'TDA2-01', grupo: 'TDA2' }, BBB333: { id: 'TDA2-02', grupo: 'TDA2' }, CCC444: { id: 'TDA1-01', grupo: 'TDA1' } },
    partidas: [],
    ahora() { return Date.now() + this.desfase; },
    iso(ms) { return new Date(ms).toISOString(); },
    publicarNotas(v = true) { this.asignacion.notas_publicadas = v; },
    caducar(segundos = 60) { for (const p of this.partidas) p.limite = this.ahora() - segundos * 1000; },
    respuestasDe(p) { return Object.fromEntries(Object.entries(p.respuestas).map(([k, v]) => [k, v.dada])); },
    ultima() { return this.partidas[this.partidas.length - 1]; }
  };
  const fuente = clave => banco.preguntas.find(p => p.id === clave.split('/')[1]);
  const al = codigo => S.alumnos[String(codigo).toUpperCase().replace(/[^A-Z0-9]/g, '')] || null;
  const ko = motivo => ({ ok: false, motivo });
  const restante = p => Math.max(0, Math.floor((p.limite - S.ahora()) / 1000));
  const cerrar = (p, estado) => {
    if (p.estado !== 'en_curso') return;
    const rs = Object.values(p.respuestas), ac = rs.filter(r => r.ok).length, fa = rs.length - ac, tot = p.seleccion.length;
    p.estado = estado; p.terminada = estado === 'caducada' ? p.limite : S.ahora(); p.total = tot; p.aciertos = ac;
    p.nota = Math.round(Math.max(0, (ac - (S.juego.reglas.penalizacion || 0) * fa) / Math.max(tot, 1) * 10) * 100) / 100;
  };
  const caducar = a => S.partidas.filter(p => p.alumno === a.id && p.estado === 'en_curso' && p.limite + 3000 < S.ahora()).forEach(p => cerrar(p, 'caducada'));
  const itemAlumno = (s) => {
    const d = fuente(s.clave), o = { clave: s.clave, tipo: d.tipo, enun: d.enun };
    for (const k of ['code', 'act', 'categoria', 'pista', 'unidad']) if (d[k] !== undefined) o[k] = d[k];
    if (d.tipo === 'opcion_multiple') o.ops = s.ops_orden.map(i => d.ops[i]);
    return o;
  };
  const salida = p => ({
    ok: true, partida: p.id, intento: p.intento, titulo: S.juego.titulo, ahora: S.iso(S.ahora()), limite: S.iso(p.limite), restante_s: restante(p),
    total: p.seleccion.length, items: p.seleccion.map(itemAlumno),
    respondidas: Object.fromEntries(Object.entries(p.respuestas).map(([clave, r]) => {
      const s = p.seleccion.find(x => x.clave === clave);
      return [clave, s.ops_orden && typeof r.dada === 'number' ? s.ops_orden.indexOf(r.dada) : r.dada];
    }))
  });
  const estadoVentana = () => (S.asignacion.desde && S.ahora() < S.asignacion.desde ? 'pronto' : S.asignacion.hasta && S.ahora() > S.asignacion.hasta ? 'cerrado' : 'abierto');

  const F = {
    mis_juegos({ p_codigo }) {
      const a = al(p_codigo); if (!a) return ko('codigo'); caducar(a);
      const mias = S.partidas.filter(p => p.alumno === a.id), asg = S.asignacion;
      return { ok: true, ahora: S.iso(S.ahora()), juegos: a.grupo !== asg.grupo ? [] : [{
        asignacion: asg.id, juego: S.juego.id, titulo: S.juego.titulo, modo: S.juego.modo, preguntas: S.juego.reglas.preguntas, tiempo_min: S.juego.reglas.tiempo_min,
        desde: asg.desde ? S.iso(asg.desde) : null, hasta: asg.hasta ? S.iso(asg.hasta) : null, intentos: asg.intentos, estado: estadoVentana(),
        hechos: mias.filter(p => p.estado !== 'en_curso').length, en_curso: (mias.find(p => p.estado === 'en_curso') || {}).id || null, notas_publicadas: asg.notas_publicadas,
        partidas: mias.map(p => (asg.notas_publicadas && p.estado !== 'en_curso') ? { id: p.id, intento: p.intento, estado: p.estado, nota: p.nota } : { id: p.id, intento: p.intento, estado: p.estado })
      }] };
    },
    empezar_partida({ p_codigo, p_asignacion }) {
      const a = al(p_codigo); if (!a) return ko('codigo'); caducar(a);
      if (p_asignacion !== S.asignacion.id || a.grupo !== S.asignacion.grupo) return ko('no_encontrada');
      const mias = S.partidas.filter(p => p.alumno === a.id), curso = mias.find(p => p.estado === 'en_curso');
      if (curso) return salida(curso);
      if (S.asignacion.desde && S.ahora() < S.asignacion.desde) return { ok: false, motivo: 'aun_no', desde: S.iso(S.asignacion.desde) };
      if (S.asignacion.hasta && S.ahora() > S.asignacion.hasta) return ko('cerrada');
      if (mias.length >= S.asignacion.intentos) return ko('sin_intentos');
      // reparto por temas, en orden de banco (determinista)
      const porTema = {}; banco.preguntas.forEach(p => (porTema[p.tema || ''] = porTema[p.tema || ''] || []).push(p));
      const cola = Object.values(porTema);
      // opciones.ids fija qué preguntas salen y en qué orden (para que las pruebas de pantalla sean cómodas)
      let elegidas = opciones.ids ? opciones.ids.map(id => banco.preguntas.find(p => p.id === id)) : [];
      for (let r = 0; !opciones.ids &&  elegidas.length < S.juego.reglas.preguntas && r < 100; r++) for (const g of cola) if (g[r] && elegidas.length < S.juego.reglas.preguntas) elegidas.push(g[r]);
      if (!elegidas.length) return ko('sin_preguntas');
      const seleccion = elegidas.map(d => ({ banco: banco.id, id: d.id, clave: banco.id + '/' + d.id,
        ops_orden: d.tipo === 'opcion_multiple' ? (() => { const n = d.ops.length, idx = [...Array(n).keys()]; return d.fija_ultima ? idx.slice(0, n - 1).reverse().concat(n - 1) : idx.reverse(); })() : null }));
      const p = { id: require('crypto').randomUUID(), alumno: a.id, intento: mias.length + 1, estado: 'en_curso', empezada: S.ahora(),
        limite: S.ahora() + S.juego.reglas.tiempo_min * 60000, seleccion, respuestas: {}, terminada: null };
      S.partidas.push(p);
      return salida(p);
    },
    responder({ p_codigo, p_partida, p_item, p_dada, p_ms }) {
      const a = al(p_codigo); if (!a) return ko('codigo');
      const p = S.partidas.find(x => x.id === p_partida && x.alumno === a.id); if (!p) return ko('no_encontrada');
      if (p.estado !== 'en_curso') return ko(p.estado);
      if (S.ahora() > p.limite + 3000) { cerrar(p, 'caducada'); return ko('caducada'); }
      const s = p.seleccion.find(x => x.clave === p_item); if (!s) return ko('item');
      const d = fuente(p_item); let orig = p_dada;
      if (d.tipo === 'opcion_multiple') { if (!Number.isInteger(p_dada) || p_dada < 0 || p_dada >= d.ops.length) return ko('dato'); orig = s.ops_orden[p_dada]; }
      else if (d.tipo === 'verdadero_falso') { if (typeof p_dada !== 'boolean') return ko('dato'); }
      else if (typeof p_dada !== 'string' || p_dada.length > 200) return ko('dato');
      p.respuestas[p_item] = { dada: orig, ok: R.renderizador(d.tipo).corregir(d, orig).ok, ms: p_ms };
      return { ok: true, restante_s: restante(p) };
    },
    evento({ p_codigo, p_partida, p_tipo, p_detalle }) {
      const a = al(p_codigo); if (!a) return ko('codigo');
      const p = S.partidas.find(x => x.id === p_partida && x.alumno === a.id); if (!p) return ko('no_encontrada');
      if (p.estado !== 'en_curso') return ko(p.estado);
      if (!['salida', 'vuelta', 'recarga', 'sin_red', 'otro'].includes(p_tipo)) return ko('dato');
      S.eventos.push({ partida: p.id, tipo: p_tipo, detalle: p_detalle || null });
      return { ok: true, anotado: true };
    },
    terminar_partida({ p_codigo, p_partida }) {
      const a = al(p_codigo); if (!a) return ko('codigo');
      const p = S.partidas.find(x => x.id === p_partida && x.alumno === a.id); if (!p) return ko('no_encontrada');
      if (p.estado === 'en_curso') cerrar(p, S.ahora() > p.limite + 3000 ? 'caducada' : 'entregada');
      return { ok: true, estado: p.estado, publicada: S.asignacion.notas_publicadas };
    },
    mi_resultado({ p_codigo, p_partida }) {
      const a = al(p_codigo); if (!a) return ko('codigo');
      const p = S.partidas.find(x => x.id === p_partida && x.alumno === a.id); if (!p) return ko('no_encontrada');
      if (p.estado === 'en_curso' && S.ahora() > p.limite + 3000) cerrar(p, 'caducada');
      const res = { ok: true, estado: p.estado, publicada: S.asignacion.notas_publicadas, terminada: p.terminada ? S.iso(p.terminada) : null };
      if (p.estado === 'en_curso') return { ...res, restante_s: restante(p) };
      if (S.asignacion.notas_publicadas) {
        res.nota = p.nota; res.aciertos = p.aciertos; res.total = p.total;
        if (S.asignacion.mostrar_soluciones) res.revision = p.seleccion.map(s => {
          const d = fuente(s.clave), r = p.respuestas[s.clave];
          return { clave: s.clave, enun: d.enun, ok: r ? r.ok : false, respondida: !!r, sol: d.sol, trampa: d.trampa,
                   correcta: d.tipo === 'opcion_multiple' ? d.ops[d.ok] : d.tipo === 'verdadero_falso' ? d.ok : d.tipo === 'numerica' ? d.valor : d.aceptadas[0] };
        });
      }
      return res;
    }
  };
  S.llamar = (fn, args) => { if (!F[fn]) return null; const r = F[fn](args || {}); S.llamadas.push({ fn, args, r }); return r; };
  return S;
}

module.exports = { crearServidorFalso, bancoDePrueba };
