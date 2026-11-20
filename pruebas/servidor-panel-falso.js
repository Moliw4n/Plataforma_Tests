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
    intentos: datos.intentos || [], bancos: datos.bancos || [], juegos: datos.juegos || [], asignaciones: datos.asignaciones || [],
    resultados: datos.resultados || {}, estadisticas: datos.estadisticas || {},      // por id de asignación: lo que devolverían profe_resultados / profe_estadisticas_examen
    peticiones: [], llamadas: [],
    sesionCaducada() { this.token = 'tok-caducado-' + (++this.n); },
    nuevoToken() { this.token = 'tok-' + (++this.n); return this.token; }
  };
  const limpia = (fila, campos) => (campos ? Object.fromEntries(campos.map(c => [c, fila[c]])) : fila);
  const TABLAS = { grupos: S.grupos, alumnos: S.alumnos, intentos: S.intentos, bancos: S.bancos, juegos: S.juegos, asignaciones: S.asignaciones };

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

module.exports = { crearServidorPanel, intentosDePrueba, EMAIL, CLAVE };
