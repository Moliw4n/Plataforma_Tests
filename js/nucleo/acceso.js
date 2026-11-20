/* Núcleo · acceso.js — la pantalla «Escribe tu código».
   mostrarAcceso({ contenedor, sup, titulo, mensaje, alEntrar })
   Cuando el código es válido llama a alEntrar({ codigo, alumno, grupo }). El código solo vive en memoria. */
import { esc } from './util.js';
import { rpc } from './api.js';

const $ = s => document.querySelector(s);

export function mostrarAcceso({ contenedor, sup = '', titulo = '', mensaje, alEntrar }) {
  contenedor.innerHTML =
    '<div class="portada acceso">' +
      '<div class="sup">' + esc(sup).toUpperCase() + '</div>' +
      '<h1>' + titulo + '</h1>' +
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
      const r = await rpc('entrar', { p_codigo: codigo }, { reintentos: 1 });
      if (r.ok) { alEntrar({ codigo, alumno: r.alumno, grupo: r.grupo }); return; }
      msg.textContent = r.motivo === 'espera' ? 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.' : 'Ese código no existe. Revísalo: no hay ceros ni letras O.';
      inp.classList.add('mal');
    } catch (err) {
      msg.textContent = 'No hay conexión con el servidor. Comprueba internet y vuelve a probar.';
    }
    $('#bEntrar').disabled = false; inp.focus(); inp.select();
  };
  inp.focus();
}
