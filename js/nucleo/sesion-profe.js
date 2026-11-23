/* Núcleo · sesion-profe.js — la sesión del PROFESOR (Supabase Auth: correo + contraseña) y las llamadas con su cuenta.
   La sesión se guarda en este navegador con la MISMA clave que el panel (`pt_sesion_profe`): si has entrado en el panel, ya estás dentro aquí, y al revés.
   Uso: const S = crearSesionProfe(CFG, { alCaducar }); S.pantallaLogin(contenedor, mensaje, alEntrar); S.api('tabla?select=…'); S.rpc('profe_…', {…}); S.salir(). */
import { esc } from './util.js';

const CLAVE = 'pt_sesion_profe';
const guarda = {
  get() { try { const v = localStorage.getItem(CLAVE); return v === null ? null : JSON.parse(v); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch (e) {} },
  del() { try { localStorage.removeItem(CLAVE); } catch (e) {} }
};

export function crearSesionProfe(CFG, { alCaducar = () => {} } = {}) {
  let ses = guarda.get();
  let renovando = null;                 // una sola renovación aunque haya varias peticiones a la vez

  async function renovarYa() {
    if (!ses || !ses.refresh) return false;
    try {
      const r = await fetch(CFG.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: ses.refresh })
      });
      const d = await r.json();
      if (!r.ok || !d.access_token) return false;
      ses = { ...ses, token: d.access_token, refresh: d.refresh_token || ses.refresh, exp: Date.now() + (d.expires_in || 3600) * 1000 };
      guarda.set(ses);
      return true;
    } catch (e) { return false; }
  }
  const renovar = () => renovando || (renovando = renovarYa().finally(() => { renovando = null; }));

  async function api(ruta, opciones = {}, reintento = true) {
    if (!ses) throw new Error('401');
    if (ses.exp < Date.now() + 60000) await renovar();
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + ruta, {
      ...opciones,
      headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + ses.token, 'Content-Type': 'application/json', ...(opciones.headers || {}) }
    });
    if (r.status === 401) {
      if (reintento && await renovar()) return api(ruta, opciones, false);
      salir(); alCaducar('Tu sesión ha caducado. Vuelve a entrar.'); throw new Error('401');
    }
    if (!r.ok) {
      const e = new Error('HTTP ' + r.status);
      try { e.detalle = (await r.json()).message || ''; } catch (x) { e.detalle = ''; }      // el motivo que da el servidor (p. ej. «directo_no_valido: …»)
      e.status = r.status; throw e;
    }
    return r.status === 204 ? null : r.json();
  }
  const rpc = (fn, args = {}) => api('rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });

  function salir() { ses = null; guarda.del(); }

  // El formulario de entrar. Cuando entra, llama a alEntrar(sesión).
  function pantallaLogin(contenedor, mensaje, alEntrar) {
    contenedor.innerHTML =
      '<form class="login" id="fLogin">' +
        '<h1>Directo del <span>profesor</span></h1>' +
        '<div class="campo"><label for="iEmail">CORREO</label><input id="iEmail" type="email" autocomplete="username" required></div>' +
        '<div class="campo"><label for="iPass">CONTRASEÑA</label><input id="iPass" type="password" autocomplete="current-password" required></div>' +
        '<button class="btn pri" id="bLogin" style="justify-content:center;padding:14px">Entrar →</button>' +
        '<p class="msg-error" id="msgLogin" role="status">' + esc(mensaje || '') + '</p>' +
      '</form>';
    const $ = s => contenedor.querySelector(s);
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
        ses = { token: d.access_token, refresh: d.refresh_token, email: (d.user && d.user.email) || $('#iEmail').value.trim(), exp: Date.now() + (d.expires_in || 3600) * 1000 };
        guarda.set(ses);
        alEntrar(ses);
      } catch (err) {
        $('#msgLogin').textContent = /fetch|network/i.test(String(err)) ? 'No hay conexión con Supabase.' : 'Correo o contraseña incorrectos.';
        $('#bLogin').disabled = false;
      }
    };
    $('#iEmail').focus();
  }

  return { api, rpc, salir, pantallaLogin, sesion: () => ses, hayRefresco: () => !!(ses && (ses.exp > Date.now() + 60000 || ses.refresh)) };
}
