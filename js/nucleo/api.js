/* Núcleo · api.js — la ÚNICA puerta hacia Supabase desde la página del alumno.
   Todo el acceso a datos pasa por aquí: si Supabase cambia, se cambia aquí y en nada más. */

export class ApiError extends Error {
  /* tipo: 'red' (no hubo respuesta) | 'http' (el servidor contestó con error) | 'tiempo' (tardó demasiado) */
  constructor(tipo, mensaje, status) { super(mensaje); this.name = 'ApiError'; this.tipo = tipo; this.status = status; }
}

const PAUSA_REINTENTO_MS = 400;
const dormir = ms => new Promise(r => setTimeout(r, ms));

/* Crea un cliente. cfg = { supabaseUrl, supabaseKey } (la clave publishable). */
export function crearApi(cfg, { tiempoMs = 15000 } = {}) {
  /* rpc(fn, args, { reintentos })
     Llama a una función de la base de datos. Devuelve el JSON. Lanza ApiError si falla.
     reintentos (0 por defecto): solo se repite si NO llegó respuesta (red caída) o el servidor
     dijo 502/503/504. Nunca se reintenta tras otro error, para no duplicar nada.
     Ojo: no pongas reintentos en funciones que escriben (guardar_intento) si no son idempotentes. */
  async function rpc(fn, args = {}, { reintentos = 0, keepalive = false } = {}) {
    for (let intento = 0; ; intento++) {
      try {
        return await una(fn, args, keepalive);
      } catch (e) {
        const reintentable = e.tipo === 'red' || (e.tipo === 'http' && [502, 503, 504].includes(e.status));
        if (!reintentable || intento >= reintentos) throw e;
        await dormir(PAUSA_REINTENTO_MS * (intento + 1));
      }
    }
  }

  // keepalive: la petición sigue aunque la página se oculte o se cierre (para avisos como «ha salido de la pestaña»)
  async function una(fn, args, keepalive) {
    const ctl = new AbortController();
    const reloj = setTimeout(() => ctl.abort(), tiempoMs);
    let r;
    try {
      r = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: { 'apikey': cfg.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: ctl.signal,
        keepalive: !!keepalive
      });
    } catch (e) {
      throw ctl.signal.aborted ? new ApiError('tiempo', 'Tiempo agotado') : new ApiError('red', 'Sin conexión');
    } finally { clearTimeout(reloj); }
    if (!r.ok) throw new ApiError('http', 'HTTP ' + r.status, r.status);
    try { return await r.json(); }
    catch (e) { throw new ApiError('http', 'Respuesta no válida', r.status); }
  }

  return { rpc };
}

/* Cliente por defecto: el de window.CONFIG (lo pone js/config.js según el entorno). */
let porDefecto = null;
export function api() {
  if (!porDefecto) {
    if (!window.CONFIG) throw new ApiError('red', 'Sin configuración de Supabase');
    porDefecto = crearApi(window.CONFIG);
  }
  return porDefecto;
}
export const rpc = (fn, args, opciones) => api().rpc(fn, args, opciones);
