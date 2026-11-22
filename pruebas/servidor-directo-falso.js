/* Servidor FALSO del modo DIRECTO, para las pruebas de la web (Playwright). Imita directo_unirse / directo_estado / directo_responder
   de supabase/09_directo.sql con LA MISMA FORMA de respuestas, y deja al «profesor» mover la sala con avanzar() (como profe_directo_avanzar).
   pruebas/contrato-directo.test.js ejecuta el mismo guion contra este y contra el SQL de verdad y compara la forma de cada respuesta.
   Ajustes para las pruebas: this.red = false (corta la red), this.desfase (ms de reloj), this.latencia (ms). */
const { bancoDePrueba } = require('./servidor-examen-falso');

const APODOS = ['Zorro Azul', 'Lobo Rojo', 'Oso Verde', 'Halcón Dorado', 'Tigre Veloz', 'León Astuto', 'Búho Sabio', 'Delfín Ágil', 'Lince Feliz', 'Cuervo Sereno'];

async function crearServidorDirecto(opciones = {}) {
  const banco = bancoDePrueba();
  const ids = opciones.preguntas || ['t1mc', 't1vf', 't2mc'];
  const S = {
    banco, red: true, desfase: 0, latencia: 0, llamadas: [],
    sesion: '11111111-1111-4111-8111-111111111111', sala: opciones.sala || '123456', grupo: 'TDA2', titulo: opciones.titulo || 'Directo de prueba',
    tiempoS: opciones.tiempoS || 20,
    preguntas: ids.map(id => ({ banco: 'grande', id, clave: 'grande/' + id })),
    estado: 'espera', actual: -1, abierta: null, limite: null,
    participantes: [], respuestas: [],          // respuestas: {alumno, pregunta, dada, ok, ms, puntos}
    alumnos: { ABC123: { id: 'TDA2-07', grupo: 'TDA2' }, AAA222: { id: 'TDA2-01', grupo: 'TDA2' }, BBB333: { id: 'TDA2-02', grupo: 'TDA2' }, CCC444: { id: 'TDA1-01', grupo: 'TDA1' }, ...(opciones.alumnos || {}) },
    ahora() { return Date.now() + this.desfase; },
    iso(ms) { return new Date(ms).toISOString(); }
  };
  const fuente = clave => banco.preguntas.find(p => p.id === clave.split('/')[1]);
  const al = codigo => S.alumnos[String(codigo).toUpperCase().replace(/[^A-Z0-9]/g, '')] || null;
  const ko = motivo => ({ ok: false, motivo });
  // jsonb_strip_nulls: quita las claves con null (también dentro de objetos)
  const sinNulos = v => Array.isArray(v) ? v.map(sinNulos) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, sinNulos(x)])) : v;
  const alDia = () => { if (S.estado === 'pregunta' && S.ahora() >= S.limite + 1000) S.estado = 'resultado'; };
  const itemAlumno = clave => {
    const d = fuente(clave), o = { clave, tipo: d.tipo, enun: d.enun };
    for (const k of ['code', 'act', 'categoria', 'pista', 'unidad']) if (d[k] !== undefined) o[k] = d[k];
    if (d.tipo === 'opcion_multiple') o.ops = d.ops.slice();            // el orden de la sala es fijo
    return o;
  };
  const participante = a => S.participantes.find(p => p.alumno === a.id);
  const respDe = (alumno, q) => S.respuestas.find(r => r.alumno === alumno && r.pregunta === q);
  const ordenar = () => [...S.participantes].sort((x, y) => y.puntos - x.puntos || (x.apodo < y.apodo ? -1 : 1));

  // ---------- lo que hace el PROFESOR (profe_directo_avanzar, simplificado) ----------
  S.avanzar = (desde) => {
    alDia();
    if (desde !== undefined && S.estado !== desde) return { ok: false, motivo: 'estado_cambiado', estado: S.estado };
    const ahora = S.ahora();
    if (S.estado === 'espera') { S.estado = 'pregunta'; S.actual = 0; S.abierta = ahora; S.limite = ahora + S.tiempoS * 1000; }
    else if (S.estado === 'pregunta') { S.estado = 'resultado'; S.limite = Math.min(S.limite, ahora); }
    else if (S.estado === 'resultado') {
      if (S.actual + 1 < S.preguntas.length) { S.estado = 'pregunta'; S.actual++; S.abierta = ahora; S.limite = ahora + S.tiempoS * 1000; }
      else S.estado = 'terminada';
    } else return { ok: false, motivo: 'terminada' };
    return { ok: true, estado: S.estado, actual: S.actual };
  };
  S.terminar = () => { S.estado = 'terminada'; };
  // Alumnos de relleno con puntos (para probar el marcador)
  S.sembrar = (puntos) => puntos.forEach((p, k) => S.participantes.push({ alumno: 'RELLENO-' + k, apodo: APODOS[(S.participantes.length) % APODOS.length] + ' ' + (k + 2), puntos: p, aciertos: 0 }));
  S.puntosDe = alumno => (S.participantes.find(p => p.alumno === alumno) || {}).puntos;

  // ---------- lo que hace el ALUMNO (las 3 funciones del SQL) ----------
  const F = {
    directo_unirse({ p_codigo, p_sala }) {
      const a = al(p_codigo); if (!a) return ko('codigo');
      alDia();
      if (S.estado === 'terminada' || p_sala !== S.sala || a.grupo !== S.grupo) return ko('sala');
      let pt = participante(a);
      if (!pt) { pt = { alumno: a.id, apodo: APODOS[S.participantes.length % APODOS.length], puntos: 0, aciertos: 0 }; S.participantes.push(pt); }
      return { ok: true, sesion: S.sesion, apodo: pt.apodo, titulo: S.titulo, total: S.preguntas.length };
    },
    directo_estado({ p_codigo, p_sesion }) {
      const a = al(p_codigo); if (!a) return ko('codigo');
      alDia();
      if (p_sesion !== S.sesion || a.grupo !== S.grupo) return ko('no_encontrada');
      const pt = participante(a); if (!pt) return ko('no_participas');
      const pos = 1 + S.participantes.filter(p => p.puntos > pt.puntos).length;
      const r = S.actual >= 0 ? respDe(a.id, S.actual) : null;
      const d = S.actual >= 0 ? fuente(S.preguntas[S.actual].clave) : null;
      const cerrada = S.estado === 'resultado' || S.estado === 'terminada';
      return sinNulos({
        ok: true, sesion: S.sesion, titulo: S.titulo, estado: S.estado, actual: S.actual, total: S.preguntas.length, tiempo_s: S.tiempoS,
        apodo: pt.apodo, puntos: pt.puntos, aciertos: pt.aciertos, posicion: pos, participantes: S.participantes.length, ahora: S.iso(S.ahora()),
        restante_ms: S.estado === 'pregunta' ? Math.max(0, S.limite - S.ahora()) : null,
        pregunta: S.estado === 'pregunta' ? itemAlumno(S.preguntas[S.actual].clave) : null,
        respondio: S.actual >= 0 && S.estado !== 'terminada' ? !!r : null,
        mi_dada: S.estado === 'pregunta' && r ? r.dada : null,
        resultado: S.estado === 'resultado' && S.actual >= 0
          ? { correcta: d.ok, sol: d.sol, respondio: !!r, ok: r ? r.ok : false, puntos: r ? r.puntos : 0, dada: r ? r.dada : null } : null,
        marcador: cerrada ? ordenar().slice(0, 5).map(p => ({ apodo: p.apodo, puntos: p.puntos, yo: p.alumno === a.id })) : null
      });
    },
    directo_responder({ p_codigo, p_sesion, p_pregunta, p_dada }) {
      const a = al(p_codigo); if (!a) return ko('codigo');
      alDia();
      if (p_sesion !== S.sesion || a.grupo !== S.grupo) return ko('no_encontrada');
      const pt = participante(a); if (!pt) return ko('no_participas');
      if (p_pregunta !== S.actual) return ko('otra_pregunta');
      if (S.estado !== 'pregunta') return ko('cerrada');
      const d = fuente(S.preguntas[S.actual].clave);
      if (d.tipo === 'opcion_multiple') { if (!Number.isInteger(p_dada) || p_dada < 0 || p_dada >= d.ops.length) return ko('dato'); }
      else if (typeof p_dada !== 'boolean') return ko('dato');
      if (respDe(a.id, S.actual)) return ko('ya_respondida');
      const ms = Math.min(Math.max(Math.round(S.ahora() - S.abierta), 0), S.tiempoS * 1000);
      const ok = d.tipo === 'opcion_multiple' ? p_dada === d.ok : p_dada === d.ok;
      const puntos = ok ? Math.round(1000 * (1 - ms / (S.tiempoS * 1000) / 2)) : 0;
      S.respuestas.push({ alumno: a.id, pregunta: S.actual, dada: p_dada, ok, ms, puntos });
      pt.puntos += puntos; if (ok) pt.aciertos++;
      return { ok: true };
    }
  };
  S.llamar = (fn, args) => { if (!F[fn]) return null; const r = F[fn](args || {}); S.llamadas.push({ fn, args, r }); return r; };
  return S;
}

module.exports = { crearServidorDirecto };
