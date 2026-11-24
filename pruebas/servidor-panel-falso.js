/* Supabase FALSO para las pruebas del PANEL del profesor: login (Auth) y lectura/borrado de tablas por REST, más las funciones profe_*.
   Imita lo que hace el real, incluido lo que NO deja hacer (select=* sobre alumnos, sesión caducada, no ser profesor).
   Los datos son inventados. Ajustes para pruebas: this.sesionCaducada(), this.refrescoFalla, this.noEsProfesor, this.red. */
const path = require('path');
const { pathToFileURL } = require('url');
const RAIZ = path.join(__dirname, '..');

const EMAIL = 'profe@ejemplo.test', CLAVE = 'clave-profe';
const error = (status, message, extra = {}) => ({ status, body: { code: 'X', message, details: null, hint: null, ...extra } });

async function crearServidorPanel(datos = {}) {
  const F = await import(pathToFileURL(path.join(RAIZ, 'js', 'nucleo', 'formato.js')).href);
  const S = {
    email: EMAIL, clave: CLAVE, token: 'tok-1', refresh: 'ref-1', n: 1, refrescoFalla: false, noEsProfesor: false, red: true,
    grupos: datos.grupos || [{ id: 'TDA2', nombre: 'TDA II' }, { id: 'TDA1', nombre: 'TDA I' }],
    alumnos: datos.alumnos || [{ id: 'TDA2-01', grupo: 'TDA2', activo: true }, { id: 'TDA2-02', grupo: 'TDA2', activo: true }, { id: 'TDA2-03', grupo: 'TDA2', activo: true }, { id: 'TDA1-01', grupo: 'TDA1', activo: true }],
    intentos: datos.intentos || [], bancos: datos.bancos || [], juegos: datos.juegos || [], asignaciones: datos.asignaciones || [], eventos: datos.eventos || [], items: datos.items || [],
    partidas: datos.partidas || [],
    directo_sesiones: datos.directo_sesiones || [], directo_participantes: datos.directo_participantes || [], directo_respuestas: datos.directo_respuestas || [],
    resultados: datos.resultados || {}, estadisticas: datos.estadisticas || {},      // por id de asignación: lo que devolverían profe_resultados / profe_estadisticas_examen
    peticiones: [], llamadas: [],
    sesionCaducada() { this.token = 'tok-caducado-' + (++this.n); },
    nuevoToken() { this.token = 'tok-' + (++this.n); return this.token; }
  };
  const limpia = (fila, campos) => (campos ? Object.fromEntries(campos.map(c => [c, fila[c]])) : fila);
  const TABLAS = { grupos: S.grupos, alumnos: S.alumnos, intentos: S.intentos, bancos: S.bancos, juegos: S.juegos, asignaciones: S.asignaciones, eventos: S.eventos, items: S.items, partidas: S.partidas,
    directo_sesiones: S.directo_sesiones, directo_participantes: S.directo_participantes, directo_respuestas: S.directo_respuestas };

  S.atender = ({ metodo, url, cuerpo, cabeceras }) => {
    S.peticiones.push({ metodo, ruta: url.pathname + url.search });
    // ---- Auth ----
    if (url.pathname === '/auth/v1/token') {
      const g = url.searchParams.get('grant_type');
      if (g === 'password') {
        if (cuerpo.email !== S.email || cuerpo.password !== S.clave) return error(400, 'Invalid login credentials', { error_description: 'Invalid login credentials' });
        return { status: 200, body: { access_token: S.token, refresh_token: S.refresh, expires_in: 3600, user: { email: S.email } } };
      }
      if (g === 'refresh_token') {
        if (S.refrescoFalla || cuerpo.refresh_token !== S.refresh) return error(400, 'Invalid Refresh Token');
        return { status: 200, body: { access_token: S.nuevoToken(), refresh_token: S.refresh, expires_in: 3600 } };
      }
    }
    // ---- REST ----
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) return error(404, 'no encontrado');
    if ((cabeceras.authorization || '') !== 'Bearer ' + S.token) return error(401, 'JWT expired');
    const nombre = m[1];
    if (nombre.startsWith('rpc')) return error(404, 'no encontrado');
    const tabla = TABLAS[nombre]; if (!tabla) return error(404, 'tabla desconocida');
    if (S.sinExamenes && ['bancos', 'juegos', 'asignaciones'].includes(nombre)) return error(404, 'Could not find the table public.' + nombre + ' in the schema cache', { code: 'PGRST205' });   // aún no se ejecutaron los SQL 06-08
    if (S.sinDirecto && nombre.startsWith('directo_')) return error(404, 'Could not find the table public.' + nombre + ' in the schema cache', { code: 'PGRST205' });   // aún no se ejecutó el SQL 09
    if (S.noEsProfesor) return { status: 200, body: [] };                         // RLS: una sesión que no es profesor ve 0 filas
    const select = url.searchParams.get('select');
    if (nombre === 'alumnos' && (!select || select.includes('*') || select.includes('codigo_hash'))) return error(403, 'permission denied for table alumnos');
    const campos = select && select !== '*' ? select.split(',') : null;
    let filas = tabla.filter(f => [...url.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(f[k]) === v.slice(3)));
    if (metodo === 'DELETE') { for (const f of filas) tabla.splice(tabla.indexOf(f), 1); return { status: 204, body: null }; }
    return { status: 200, body: filas.map(f => limpia(f, campos)) };
  };

  // ---- funciones profe_* (las del examen devuelven lo que el test haya dejado preparado) ----
  S.rpc = (fn, args, cabeceras) => {
    S.llamadas.push({ fn, args });
    if ((cabeceras.authorization || '') !== 'Bearer ' + S.token) return error(401, 'JWT expired');
    if (S.noEsProfesor) return error(400, 'no_autorizado');
    const nuevoBanco = args.p_banco;
    switch (fn) {
      case 'profe_subir_banco': {
        const problemas = F.validarBanco(nuevoBanco);
        if (problemas.length) return error(400, 'item_no_valido: ' + problemas[0]);
        if (S.bancoEnUso && S.bancoEnUso === nuevoBanco.id) return error(400, 'banco_en_uso');
        const previo = S.bancos.find(b => b.id === nuevoBanco.id);
        const version = previo ? previo.version + 1 : 1;
        if (previo) Object.assign(previo, { titulo: nuevoBanco.titulo, version }); else S.bancos.push({ id: nuevoBanco.id, titulo: nuevoBanco.titulo, materia: nuevoBanco.materia || null, unidad: nuevoBanco.unidad || null, version, items: nuevoBanco.preguntas.length });
        return { status: 200, body: { ok: true, banco: nuevoBanco.id, version, items: nuevoBanco.preguntas.length } };
      }
      case 'profe_borrar_banco': {
        if (S.juegos.some(j => j.bancos.includes(args.p_id))) return error(400, 'banco_en_uso');
        const i = S.bancos.findIndex(b => b.id === args.p_id); if (i >= 0) S.bancos.splice(i, 1);
        return { status: 200, body: { ok: i >= 0 } };
      }
      case 'profe_crear_juego': {
        const j = args.p_juego;
        if (!j.bancos || !j.bancos.every(b => S.bancos.some(x => x.id === b))) return error(400, 'juego_no_valido: algún banco no existe');
        const reglas = { preguntas: 20, tiempo_min: 30, penalizacion: 0, equilibrar: 'tema', ...(j.reglas || {}) };
        if (S.partidas.some(pa => { const a = S.asignaciones.find(x => x.id === pa.asignacion); return a && a.juego === j.id; })) return error(400, 'juego_en_uso');
        const previo = S.juegos.find(x => x.id === j.id), nuevo = { id: j.id, modo: j.modo, titulo: j.titulo, bancos: j.bancos, reglas };
        if (previo) Object.assign(previo, nuevo); else S.juegos.push(nuevo);
        return { status: 200, body: { ok: true, juego: j.id, reglas } };
      }
      case 'profe_asignar': {
        if (!S.juegos.some(j => j.id === args.p_juego)) return error(400, 'asignacion_no_valida: el juego no existe');
        if (!S.grupos.some(g => g.id === args.p_grupo)) return error(400, 'asignacion_no_valida: el grupo no existe');
        let a = S.asignaciones.find(x => x.juego === args.p_juego && x.grupo === args.p_grupo);
        const campos = { desde: args.p_desde || null, hasta: args.p_hasta || null, intentos: args.p_intentos || 1, mostrar_soluciones: !!args.p_mostrar_soluciones };
        if (a) Object.assign(a, campos); else { a = { id: S.asignaciones.length + 1, juego: args.p_juego, grupo: args.p_grupo, notas_publicadas: false, ...campos }; S.asignaciones.push(a); }
        return { status: 200, body: { ok: true, asignacion: a.id } };
      }
      case 'profe_publicar_notas': {
        const a = S.asignaciones.find(x => x.id === args.p_asignacion);
        if (a) a.notas_publicadas = args.p_publicar !== false;
        return { status: 200, body: { ok: !!a, notas_publicadas: args.p_publicar !== false } };
      }
      case 'profe_resultados': {
        const a = S.asignaciones.find(x => x.id === args.p_asignacion); if (!a) return { status: 200, body: { ok: false, motivo: 'no_encontrada' } };
        const j = S.juegos.find(x => x.id === a.juego), r = S.resultados[a.id] || { partidas: [] };
        return { status: 200, body: { ok: true, asignacion: { id: a.id, juego: a.juego, titulo: j ? j.titulo : a.juego, grupo: a.grupo, desde: a.desde, hasta: a.hasta, intentos: a.intentos, mostrar_soluciones: a.mostrar_soluciones, notas_publicadas: a.notas_publicadas }, partidas: r.partidas } };
      }
      case 'profe_estadisticas_examen': {
        const a = S.asignaciones.find(x => x.id === args.p_asignacion); if (!a) return { status: 200, body: { ok: false, motivo: 'no_encontrada' } };
        return { status: 200, body: { ok: true, partidas: (S.resultados[a.id] || { partidas: [] }).partidas.filter(p => p.estado !== 'en_curso').length, preguntas: (S.estadisticas[a.id] || []) } };
      }
      case 'profe_borrar_partida': {
        for (const r of Object.values(S.resultados)) { const i = r.partidas.findIndex(p => p.partida === args.p_id); if (i >= 0) { r.partidas.splice(i, 1); return { status: 200, body: { ok: true } }; } }
        return { status: 200, body: { ok: false } };
      }
      case 'profe_cerrar_caducadas': return { status: 200, body: { ok: true, cerradas: 0 } };
    }
    // Directo: lo atiende el servidor falso del directo si el test lo ha enchufado (servidor.panel.directo = servidor.directo)
    if (fn.startsWith('profe_directo_') && S.sinDirecto) return error(404, 'Could not find the function public.' + fn + ' in the schema cache', { code: 'PGRST202' });     // aún no se ejecutó el SQL 09
    if (fn === 'profe_directo_borrar' && !S.directo) {               // borrar una sala ya jugada (en cascada, como el SQL real)
      const i = S.directo_sesiones.findIndex(x => x.id === args.p_sesion);
      if (i >= 0) { S.directo_sesiones.splice(i, 1); for (const t of [S.directo_participantes, S.directo_respuestas]) for (let k = t.length - 1; k >= 0; k--) if (t[k].sesion === args.p_sesion) t.splice(k, 1); }
      return { status: 200, body: { ok: i >= 0 } };
    }
    if (fn.startsWith('profe_directo_') && S.directo) {
      const r = S.directo.profe(fn, args);
      if (r === null) return error(404, 'función desconocida: ' + fn);
      return r.error ? error(400, r.error) : { status: 200, body: r };
    }
    return error(404, 'función desconocida: ' + fn);
  };
  return S;
}

// Datos de partida para las pruebas del panel: intentos de práctica con respuestas de los tests reales (ids q01…)
function intentosDePrueba() {
  const resp = (ids, malas = []) => ids.map((id, k) => ({ id, elegida: malas.includes(id) ? 0 : 1, ok: !malas.includes(id), ms: 4000 + k * 1000 }));
  const ids = ['q01', 'q02', 'q03', 'q04'];
  const I = (n, alumno, test, nota, malas, terminado) => ({ id: n, alumno, test_id: test, version: 1, empezado: terminado, terminado, segundos: 300 + n * 10, total: 4, aciertos: 4 - malas.length, nota, respuestas: resp(ids, malas) });
  return [
    I(1, 'TDA2-01', 'tda2-u1-python-practica', 5, ['q01', 'q02'], '2026-11-18T10:00:00Z'),
    I(2, 'TDA2-01', 'tda2-u1-python-practica', 7.5, ['q01'], '2026-11-19T10:00:00Z'),
    I(3, 'TDA2-02', 'tda2-u1-python-practica', 10, [], '2026-11-19T11:00:00Z'),
    I(4, 'TDA1-01', 'tda1-u1u2-repaso', 2.5, ['q01', 'q02', 'q03'], '2026-11-19T12:00:00Z')
  ];
}

// Un examen ya hecho por parte del grupo TDA2: lo que devolverían profe_resultados y profe_estadisticas_examen (misma forma que el SQL real)
function datosExamen() {
  const respuestas = (...estados) => estados.map((e, k) => ({ id: 'u1/q' + (k + 1), respondida: e !== 'blanco', ok: e === 'ok', dada: e === 'blanco' ? null : [0, true, 'bucle for', 3.5][k % 4], ms: e === 'blanco' ? null : 3000 + k * 1000 }));
  const ev = (salidas = 0, fuera = 0, recargas = 0, sin_red = 0) => ({ salidas, vueltas: salidas, recargas, sin_red, segundos_fuera: fuera });
  const P = (partida, alumno, estado, nota, acier, seg, eventos, resp, intento = 1) => ({ partida, alumno, juego: 'ex1', intento, estado, empezada: '2026-11-25T09:00:00+00:00',
    terminada: estado === 'en_curso' ? null : '2026-11-25T09:25:00+00:00', segundos: estado === 'en_curso' ? null : seg, total: estado === 'en_curso' ? null : 4, aciertos: estado === 'en_curso' ? null : acier,
    nota, puntos: 0, por_criterio: { '2.1': 0.5 }, eventos, respuestas: resp });
  const pregunta = (n, enun, tipo, tema, aciertos, fallos, blancos, reparto) => ({ clave: 'u1/q' + n, enun, tipo, tema, criterio: '2.1', n: aciertos + fallos + blancos, respondidas: aciertos + fallos, aciertos, fallos, blancos,
    pct_fallo: Math.round((fallos + blancos) / (aciertos + fallos + blancos) * 1000) / 10, ms_tipico: 4000 + n * 1000, reparto: reparto || null });
  return {
    bancos: [{ id: 'u1', titulo: 'Banco U1 · Python', materia: 'TDA II', unidad: 'U1', version: 1 }],
    juegos: [{ id: 'ex1', modo: 'examen', titulo: 'Examen U1 · Python', bancos: ['u1'], reglas: { preguntas: 20, tiempo_min: 30, penalizacion: 0, equilibrar: 'tema' } }],
    partidas: [{ asignacion: 1 }, { asignacion: 1 }],          // el examen «ex1» ya lo han empezado dos alumnos (no se puede cambiar)
    asignaciones: [{ id: 1, juego: 'ex1', grupo: 'TDA2', desde: null, hasta: null, intentos: 1, mostrar_soluciones: false, notas_publicadas: false }],
    items: [
      { banco: 'u1', id: 'q1', tipo: 'opcion_multiple', datos: { tipo: 'opcion_multiple', enun: 'Primera', ops: ['uno', 'dos', 'tres'], ok: 0, sol: 'Porque uno.' } },
      { banco: 'u1', id: 'q2', tipo: 'verdadero_falso', datos: { tipo: 'verdadero_falso', enun: 'Segunda', ok: true, sol: 'Es verdadera.' } },
      { banco: 'u1', id: 'q3', tipo: 'respuesta_corta', datos: { tipo: 'respuesta_corta', enun: 'Tercera', aceptadas: ['bucle for', 'for'], sol: 'Se llama for.' } },
      { banco: 'u1', id: 'q4', tipo: 'numerica', datos: { tipo: 'numerica', enun: 'Cuarta', valor: 3.5, tolerancia: 0.1, unidad: 'm', sol: 'Medio.' } }
    ],
    eventos: [
      { partida: 'aaaaaaaa-0000-4000-8000-000000000001', tipo: 'salida', momento: '2026-11-25T09:10:00.123456+00:00', detalle: null },
      { partida: 'aaaaaaaa-0000-4000-8000-000000000001', tipo: 'vuelta', momento: '2026-11-25T09:10:12.500000+00:00', detalle: { segundos: 12 } },
      { partida: 'aaaaaaaa-0000-4000-8000-000000000001', tipo: 'salida', momento: '2026-11-25T09:12:00+00:00', detalle: null },
      { partida: 'aaaaaaaa-0000-4000-8000-000000000001', tipo: 'vuelta', momento: '2026-11-25T09:12:30+00:00', detalle: { segundos: 30 } },
      { partida: 'aaaaaaaa-0000-4000-8000-000000000002', tipo: 'recarga', momento: '2026-11-25T09:05:00+00:00', detalle: null }
    ],
    resultados: { 1: { partidas: [
      P('aaaaaaaa-0000-4000-8000-000000000001', 'TDA2-01', 'entregada', 7.5, 3, 1500, ev(2, 42), respuestas('ok', 'ok', 'mal', 'ok')),
      P('aaaaaaaa-0000-4000-8000-000000000002', 'TDA2-02', 'en_curso', null, null, null, ev(0, 0, 1), respuestas('ok', 'blanco', 'blanco', 'blanco'))
    ] } },
    estadisticas: { 1: [
      pregunta(3, 'La pregunta más fallada', 'opcion_multiple', 'bucles', 0, 1, 0, [{ texto: 'opción uno', veces: 0, correcta: true }, { texto: 'la trampa', veces: 1, correcta: false }, { texto: 'opción tres', veces: 0, correcta: false }, { texto: 'opción cuatro', veces: 0, correcta: false }]),
      pregunta(1, 'Una pregunta fácil', 'verdadero_falso', 'variables', 1, 0, 0),
      pregunta(2, 'Otra pregunta', 'respuesta_corta', 'cadenas', 1, 0, 0)
    ] }
  };
}

// Una sala de directo ya jugada por el grupo TDA2 (3 preguntas; entraron 2 de los 3 alumnos). Misma forma que las tablas directo_* del SQL real.
function datosDirecto() {
  const sesion = 'dddddddd-0000-4000-8000-000000000001';
  const R = (alumno, pregunta, dada, ok, ms, puntos) => ({ sesion, alumno, pregunta, dada, ok, ms, puntos, momento: '2026-11-25T10:05:00+00:00' });
  return {
    items: [
      { banco: 'd1', id: 'q1', tipo: 'opcion_multiple', tema: 'bucles', criterio: '2.1', datos: { tipo: 'opcion_multiple', enun: 'Primera del directo', ops: ['uno', 'dos', 'tres'], ok: 0, sol: 'Porque uno.' } },
      { banco: 'd1', id: 'q2', tipo: 'verdadero_falso', tema: 'variables', criterio: '2.1', datos: { tipo: 'verdadero_falso', enun: 'Segunda del directo', ok: true, sol: 'Es verdadera.' } },
      { banco: 'd1', id: 'q3', tipo: 'opcion_multiple', tema: 'cadenas', criterio: '2.2', datos: { tipo: 'opcion_multiple', enun: 'Tercera del directo', ops: ['a', 'b', 'c'], ok: 2, sol: 'Es la c.' } }
    ],
    directo_sesiones: [
      { id: sesion, sala: '123456', grupo: 'TDA2', titulo: 'Directo U1', bancos: ['d1'], tiempo_s: 20, lectura_s: 3, estado: 'terminada', actual: 2, creada: '2026-11-25T10:00:00+00:00', terminada: '2026-11-25T10:10:00+00:00',
        preguntas: [{ banco: 'd1', id: 'q1', clave: 'd1/q1' }, { banco: 'd1', id: 'q2', clave: 'd1/q2' }, { banco: 'd1', id: 'q3', clave: 'd1/q3' }] },
      { id: 'dddddddd-0000-4000-8000-000000000002', sala: '654321', grupo: 'TDA2', titulo: 'Sala que no empezó', bancos: ['d1'], tiempo_s: 20, lectura_s: 0, estado: 'espera', actual: -1, creada: '2026-11-25T11:00:00+00:00', terminada: null, preguntas: [] }
    ],
    directo_participantes: [
      { sesion, alumno: 'TDA2-01', apodo: 'Zorro Azul', puntos: 1900, aciertos: 2 },
      { sesion, alumno: 'TDA2-02', apodo: 'Lince Verde', puntos: 900, aciertos: 1 }
    ],
    directo_respuestas: [
      R('TDA2-01', 0, 0, true, 3000, 950), R('TDA2-01', 1, true, true, 5000, 950), R('TDA2-01', 2, 1, false, 6000, 0),
      R('TDA2-02', 0, 1, false, 4000, 0), R('TDA2-02', 1, true, true, 9000, 900)
    ]
  };
}

module.exports = { crearServidorPanel, intentosDePrueba, datosExamen, datosDirecto, EMAIL, CLAVE };
