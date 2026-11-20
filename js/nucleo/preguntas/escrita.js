/* Núcleo · preguntas/escrita.js — pantalla común de las preguntas que se contestan ESCRIBIENDO
   (numerica, respuesta_corta). cfg: { atributos, placeholder, unidad?, aviso(texto)→string|null, textoCorrecta(p)→html }
   Misma interfaz que todos los tipos. La respuesta (dada) es el TEXTO tal como lo escribió el alumno. */
import { esc } from '../util.js';
import { escAttr, marco, pintarVeredicto, enlazarChuleta } from './comun.js';

export function pintarEscrita(p, contenedor, o, cfg) {
  let resp = o.respuesta || null;
  const r = resp;
  const estado = r ? (r.ok ? ' bien' : ' mal') : '';
  const interior =
    '<form class="resp-escrita" autocomplete="off" novalidate>' +
      '<input class="entrada' + estado + '" type="text" ' + cfg.atributos + ' value="' + (r ? escAttr(r.dada) : '') + '"' + (r ? ' disabled' : '') +
        ' placeholder="' + escAttr(cfg.placeholder) + '" aria-label="Tu respuesta" aria-describedby="avisoResp">' +
      (cfg.unidad ? '<span class="unidad">' + esc(cfg.unidad) + '</span>' : '') +
      '<button class="btn pri" type="submit"' + (r ? ' disabled' : '') + '>Comprobar</button>' +
    '</form>' +
    '<p class="aviso-resp" id="avisoResp" role="status"></p>';
  const extra = '<div class="caja respuesta"><b>LA RESPUESTA</b>' + cfg.textoCorrecta(p) + '</div>';
  contenedor.innerHTML = marco(p, o, !!r, interior, extra);

  const form = contenedor.querySelector('.resp-escrita'), input = form.querySelector('input'), aviso = contenedor.querySelector('.aviso-resp');
  form.onsubmit = e => {
    e.preventDefault();
    const texto = input.value.trim();
    if (!texto) { aviso.textContent = 'Escribe tu respuesta.'; input.focus(); return; }
    const problema = cfg.aviso && cfg.aviso(texto);
    if (problema) { aviso.textContent = problema; input.focus(); return; }
    aviso.textContent = '';
    o.alResponder(texto);
  };
  input.oninput = () => { aviso.textContent = ''; };
  enlazarChuleta(contenedor, o);
  if (r) pintarVeredicto(contenedor, r.ok);
  else if (window.matchMedia && matchMedia('(hover:hover)').matches) input.focus();   // en el móvil no: abriría el teclado sin pedirlo

  function bloquear() { input.disabled = true; form.querySelector('button').disabled = true; }
  function mostrarCorreccion(c) {
    resp = { dada: c.dada, ok: c.ok };
    bloquear();
    input.classList.add(c.ok ? 'bien' : 'mal');
    pintarVeredicto(contenedor, c.ok);
    contenedor.querySelector('.q').classList.add('resuelta');
  }
  return { respuesta: () => resp, bloquear, mostrarCorreccion };
}
