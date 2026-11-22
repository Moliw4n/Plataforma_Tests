/* Núcleo · modos.js — el contrato de los modos de juego y cómo se cargan.

   Cada modo es una carpeta js/modos/<id>/index.js cuyo `export default` cumple:
     {
       id: 'practica',                       // igual que el nombre de la carpeta
       nombre: 'Práctica',
       necesita: { directo: false, servidor: true },   // capacidades que usa
       tiposPregunta: ['opcion_multiple'],   // tipos de pregunta que sabe jugar
       async iniciar(ctx) {},                // arranca el modo
       async terminar() {}                   // limpia y devuelve el RESULTADO NORMALIZADO
     }
   ctx = { alumno, juego, contenido, api, nucleo, contenedor, chuleta, modoProfe, salir }
     alumno     {codigo, alumno:'TDA2-07', grupo} o null (modo profesor / sin conexión)
     juego      la asignación del juego a este alumno, tal como la da mis_juegos() (null en la práctica de tests/*.json)
     contenido  el banco/test ya cargado ({id, titulo, preguntas, …}) · null en los modos que traen las preguntas del servidor (examen)
     api        { rpc } · la única puerta a Supabase
     nucleo     piezas comunes (pintar de cada tipo de pregunta, …)
     contenedor elemento donde el modo dibuja
     chuleta    { abrir, cerrar, abierta, lista } o null
     modoProfe  true = no se guarda nada
     salir()    vuelve a la pantalla del código («No soy yo»)

   Resultado normalizado (lo que lee Kronos, igual para cualquier modo):
     { partida, alumno, juego, nota 0-10, puntos, segundos, por_criterio:{'2.1':0.8}, respuestas:[…] } */

const ID_VALIDO = /^[a-z0-9_-]+$/;

export function validarModo(m, id) {
  const falla = por => { throw new Error('El modo «' + id + '» no cumple el contrato: ' + por); };
  if (!m || typeof m !== 'object') falla('no exporta un objeto por defecto');
  if (m.id !== id) falla('su id («' + m.id + '») no coincide con la carpeta');
  if (typeof m.nombre !== 'string' || !m.nombre) falla('falta nombre');
  if (!m.necesita || typeof m.necesita !== 'object') falla('falta necesita');
  if (!Array.isArray(m.tiposPregunta) || !m.tiposPregunta.length) falla('falta tiposPregunta');
  if (typeof m.iniciar !== 'function') falla('falta iniciar()');
  if (typeof m.terminar !== 'function') falla('falta terminar()');
  return m;
}

export async function cargarModo(id) {
  if (!ID_VALIDO.test(id)) throw new Error('Modo no válido: ' + id);
  const modulo = await import('../modos/' + id + '/index.js');
  return validarModo(modulo.default, id);
}

/* Rellena lo que falte para que todos los modos devuelvan la misma forma. */
export function resultadoNormalizado(r) {
  return {
    partida: r.partida ?? null,
    alumno: r.alumno ?? null,
    juego: r.juego ?? null,
    nota: r.nota === undefined ? 0 : r.nota,      // null = «no se sabe todavía» (examen: la nota está oculta)
    puntos: r.puntos ?? 0,
    segundos: r.segundos ?? 0,
    por_criterio: r.por_criterio || {},
    respuestas: r.respuestas || []
  };
}
