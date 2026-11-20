/* Núcleo · formato.js — formato del contenido (bancos y tests), conversor y validador.

   FORMATO 1 (el de los tests actuales, en tests/*.json):
     test:     { id, titulo, materia, unidad, version, chuleta, tipos?, preguntas }
     pregunta: { id, tipo:'imprime'|'error'|'hueco'|…  ← categoría visual, act, tema, enun, ops, ok, sol, trampa, … }
   FORMATO 2 (el nuevo; `formato: 2`):
     test:     { formato:2, id, titulo, materia, unidad, version, chuleta, categorias?, preguntas }
     pregunta: { id, tipo:'opcion_multiple'  ← TIPO DE PREGUNTA (qué renderizador y cómo se corrige),
                 categoria:'imprime'  ← la etiqueta de color de antes,
                 act, tema, enun, ops, ok, sol, trampa, … ,
                 dificultad?:1-3, criterio?:'2.1', etiquetas?:[…] }
   Todo lo que el conversor no conoce se conserva tal cual (code, salida, stdin, run_with, fija_ultima…).
   La web trabaja siempre en formato 2: aFormato2() se aplica al cargar (y es idempotente). */

export const FORMATO_ACTUAL = 2;

// Tipos de pregunta del plan (4.2). Los de SOPORTADOS tienen renderizador en nucleo/preguntas/.
export const TIPOS_CONOCIDOS = ['opcion_multiple', 'verdadero_falso', 'respuesta_corta', 'numerica', 'ordenar', 'emparejar', 'huecos', 'codigo'];
export const TIPOS_SOPORTADOS = ['opcion_multiple', 'verdadero_falso', 'numerica', 'respuesta_corta'];   // = TIPOS_JUGABLES de preguntas/index.js (hay un test que lo comprueba)

/* formato 1 → formato 2. No modifica el original. Si ya es formato 2, lo devuelve igual. */
export function aFormato2(t) {
  if (!t || t.formato === 2) return t;
  const { tipos, preguntas, ...resto } = t;
  const salida = { formato: 2, ...resto };
  if (tipos) salida.categorias = tipos;
  salida.preguntas = (preguntas || []).map(p => {
    const { tipo, ...otros } = p;
    return { tipo: 'opcion_multiple', categoria: tipo, ...otros };
  });
  return salida;
}

/* formato 2 → formato 1 (solo para comprobar que la conversión no pierde nada; solo opción múltiple). */
export function aFormato1(t) {
  if (!t || t.formato !== 2) return t;
  const { formato, categorias, preguntas, ...resto } = t;
  const salida = { ...resto };
  if (categorias) salida.tipos = categorias;
  salida.preguntas = preguntas.map(p => {
    if (p.tipo !== 'opcion_multiple') throw new Error('aFormato1 solo vale para opcion_multiple (pregunta ' + p.id + ')');
    const { tipo, categoria, ...otros } = p;
    return { tipo: categoria, ...otros };
  });
  return salida;
}

const esTexto = v => typeof v === 'string' && v.trim() !== '';

/* Valida un banco o test en formato 2. Devuelve una lista de problemas (vacía = todo bien).
   opciones.soportados: tipos que se aceptan (por defecto, los que ya tienen renderizador).
   opciones.exigirSolTrampa (por defecto true): cada pregunta lleva `sol` y `trampa`, la seña de identidad. */
export function validarBanco(t, { soportados = TIPOS_SOPORTADOS, exigirSolTrampa = true } = {}) {
  const e = [];
  if (!t || typeof t !== 'object') return ['El banco no es un objeto'];
  if (t.formato !== 2) e.push('Falta «formato: 2» (usa aFormato2 para convertirlo)');
  if (!esTexto(t.id)) e.push('Falta el id del banco');
  else if (!/^[a-z0-9][a-z0-9_-]*$/.test(t.id)) e.push('El id «' + t.id + '» solo puede llevar minúsculas, números, - y _');
  if (!esTexto(t.titulo)) e.push('Falta el título');
  if (!Array.isArray(t.preguntas) || !t.preguntas.length) { e.push('No hay preguntas'); return e; }
  const cats = t.categorias && typeof t.categorias === 'object' ? t.categorias : null;
  const vistos = new Set();
  t.preguntas.forEach((p, i) => {
    const q = 'Pregunta ' + (i + 1) + (p && p.id ? ' (' + p.id + ')' : '') + ': ';
    if (!p || typeof p !== 'object') { e.push(q + 'no es un objeto'); return; }
    if (!esTexto(p.id)) e.push(q + 'falta el id');
    else if (vistos.has(p.id)) e.push(q + 'el id está repetido'); else vistos.add(p.id);
    if (!TIPOS_CONOCIDOS.includes(p.tipo)) { e.push(q + 'tipo «' + p.tipo + '» desconocido'); return; }
    if (!soportados.includes(p.tipo)) { e.push(q + 'el tipo «' + p.tipo + '» todavía no se puede jugar'); return; }
    if (!esTexto(p.enun)) e.push(q + 'falta el enunciado (enun)');
    if (exigirSolTrampa) {
      if (!esTexto(p.sol)) e.push(q + 'falta «sol» (por qué)');
      if (!esTexto(p.trampa)) e.push(q + 'falta «trampa»');
    }
    if (p.tipo === 'opcion_multiple') {
      if (!Array.isArray(p.ops) || p.ops.length < 2 || !p.ops.every(o => typeof o === 'string')) e.push(q + 'ops debe ser una lista de al menos 2 textos');
      else if (!Number.isInteger(p.ok) || p.ok < 0 || p.ok >= p.ops.length) e.push(q + 'ok debe ser el número de la opción correcta (0 a ' + (p.ops.length - 1) + ')');
    }
    if (p.tipo === 'verdadero_falso' && typeof p.ok !== 'boolean') e.push(q + 'ok debe ser true o false');
    if (p.tipo === 'numerica') {
      if (typeof p.valor !== 'number' || !Number.isFinite(p.valor)) e.push(q + 'valor debe ser un número');
      if (p.tolerancia !== undefined && !(typeof p.tolerancia === 'number' && Number.isFinite(p.tolerancia) && p.tolerancia >= 0)) e.push(q + 'tolerancia debe ser un número mayor o igual que 0');
      if (p.unidad !== undefined && !esTexto(p.unidad)) e.push(q + 'unidad debe ser un texto');
    }
    if (p.tipo === 'respuesta_corta') {
      if (!Array.isArray(p.aceptadas) || !p.aceptadas.length || !p.aceptadas.every(a => esTexto(a))) e.push(q + 'aceptadas debe ser una lista con al menos una respuesta');
      if (p.pista !== undefined && !esTexto(p.pista)) e.push(q + 'pista debe ser un texto');
    }
    if (p.categoria !== undefined && cats && !cats[p.categoria] && !['imprime', 'error', 'hueco'].includes(p.categoria)) e.push(q + 'la categoría «' + p.categoria + '» no está en «categorias»');
    if (p.dificultad !== undefined && ![1, 2, 3].includes(p.dificultad)) e.push(q + 'dificultad debe ser 1, 2 o 3');
    if (p.criterio !== undefined && !esTexto(p.criterio)) e.push(q + 'criterio debe ser un texto, por ejemplo «2.1»');
    if (p.etiquetas !== undefined && !(Array.isArray(p.etiquetas) && p.etiquetas.every(esTexto))) e.push(q + 'etiquetas debe ser una lista de textos');
  });
  return e;
}
