/* Núcleo · chuleta.js — el panel de la chuleta (botón amarillo, pestañas por tema).
   Usa los elementos de jugar.html: #bChuleta, #capaChuleta, #pestanas, #cuerpoChuleta, #tituloChuleta, #bCerrarChuleta.
   crearChuleta({ url, materia, temaActual }) → { abrir(tema), cerrar(), abierta(), lista() }
   temaActual: función que devuelve el tema de la pregunta que se está viendo (para abrir en su pestaña). */
import { esc } from './util.js';
import { pinta } from './codigo.js';

const $ = s => document.querySelector(s);

export function crearChuleta({ url, materia = '', temaActual = () => null }) {
  const capa = $('#capaChuleta');
  let lista = false;

  function verTema(tema) {
    const cuerpo = $('#cuerpoChuleta');
    let hay = false;
    cuerpo.querySelectorAll('section').forEach(s => { const on = s.dataset.tema === tema; s.classList.toggle('on', on); hay = hay || on; });
    if (!hay) { const s = cuerpo.querySelector('section'); if (s) { s.classList.add('on'); tema = s.dataset.tema; } }
    $('#pestanas').querySelectorAll('button').forEach(b => { const on = b.dataset.tema === tema; b.classList.toggle('on', on); if (on) b.scrollIntoView({ block: 'nearest', inline: 'center' }); });
    cuerpo.scrollTop = 0;
  }
  function abrir(tema) {
    if (!lista) return;
    verTema(tema || temaActual() || null);
    capa.classList.add('on');
    $('#bCerrarChuleta').focus();
  }
  function cerrar() { capa.classList.remove('on'); }

  async function preparar() {
    $('#bChuleta').hidden = false;
    $('#bChuleta').onclick = () => abrir();
    $('#bCerrarChuleta').onclick = cerrar;
    capa.addEventListener('click', e => { if (e.target === capa) cerrar(); });
    try {
      const html = window.CHULETA_EMBEBIDA || await (await fetch(url, { cache: 'no-cache' })).text();
      const cuerpo = $('#cuerpoChuleta');
      cuerpo.innerHTML = html;
      cuerpo.querySelectorAll('pre.py').forEach(pre => pre.innerHTML = pinta(pre.textContent.replace(/^\n/, '')));
      const secs = [...cuerpo.querySelectorAll('section')];
      $('#pestanas').innerHTML = secs.map(s => '<button data-tema="' + s.dataset.tema + '" data-color="' + (s.dataset.color || '') + '" style="--c:var(--' + (s.dataset.color || 'naranja') + ')">' + esc(s.dataset.nombre) + '</button>').join('');
      $('#pestanas').querySelectorAll('button').forEach(b => b.onclick = () => verTema(b.dataset.tema));
      $('#tituloChuleta').textContent = 'CHULETA · ' + materia;
      lista = true;
      verTema(secs[0] && secs[0].dataset.tema);
    } catch (e) { $('#bChuleta').hidden = true; }
  }
  preparar();

  return { abrir, cerrar, abierta: () => capa.classList.contains('on'), lista: () => lista };
}
