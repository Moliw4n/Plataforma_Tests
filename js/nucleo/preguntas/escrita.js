/* Núcleo · preguntas/escrita.js — pantalla común de las preguntas que se contestan ESCRIBIENDO
   (numerica, respuesta_corta). cfg: { atributos, placeholder, unidad?, aviso(texto)→string|null, textoCorrecta(p)→html }
   Misma interfaz que todos los tipos. La respuesta (dada) es el TEXTO tal como lo escribió el alumno. */
import { esc } from '../util.js';
import { escAttr, izquierda, marco, pintarVeredicto, enlazarChuleta } from './comun.js';

/* Modo examen: se escribe y se GUARDA (botón o Intro); se puede cambiar hasta entregar; no se corrige nada en pantalla.
   Devuelve además pendiente(): el texto escrito y aún sin guardar (para guardarlo al cambiar de pregunta), o null. */
function pintarEscritaExamen(p, contenedor, o, cfg) {
  let guardada = o.respuesta && o.respuesta.dada !== undefined ? String(o.respuesta.dada) : '';
  const interior =
    '<form class="resp-escrita" autocomplete="off" novalidate>' +
      '<input class="entrada" type="text" ' + cfg.atributos + ' value="' + escAttr(guardada) + '" placeholder="' + escAttr(cfg.placeholder) + '" aria-label="Tu respuesta" aria-describedby="avisoResp">' +
      (cfg.unidad ? '<span class="unidad">' + esc(cfg.unidad) + '</span>' : '') +
      '<button class="btn pri" type="submit">Guardar</button>' +
    '</form>' +
    '<p class="aviso-resp" id="avisoResp" role="status">' + (guardada ? '✓ Respuesta guardada' : '') + '</p>';
  contenedor.innerHTML = '<div class="q en-examen' + (p.code ? '' : ' sin-codigo') + '">' + izquierda(p, o) + '<div class="der">' + interior + '</div></div>';
  const form = contenedor.querySelector('.resp-escrita'), input = form.querySelector('input'), aviso = contenedor.querySelector('.aviso-resp');
  form.onsubmit = e => {
    e.preventDefault();
    const texto = input.value.trim();
    if (!texto) { aviso.textContent = 'Escribe tu respuesta.'; input.focus(); return; }
    const problema = cfg.aviso && cfg.aviso(texto);
    if (problema) { aviso.textContent = problema; input.focus(); return; }
    if (texto !== guardada) { guardada = texto; o.alResponder(texto); }
    aviso.textContent = '✓ Respuesta guardada';
  };
  input.oninput = () => { aviso.textContent = input.value.trim() === guardada ? (guardada ? '✓ Respuesta guardada' : '') : 'Falta guardar: pulsa Guardar o Intro'; };
  if (window.matchMedia && matchMedia('(hover:hover)').matches) input.focus();
  const pendiente = () => { const t = input.value.trim(); return t && t !== guardada && !(cfg.aviso && cfg.aviso(t)) ? t : null; };
  return { respuesta: () => (guardada ? { dada: guardada } : null), bloquear() {}, mostrarCorreccion() {}, pendiente };
}

export function pintarEscrita(p, contenedor, o, cfg) {
  if (o.examen) return pintarEscritaExamen(p, contenedor, o, cfg);
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
