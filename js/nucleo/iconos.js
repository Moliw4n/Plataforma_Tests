/* Iconos del profesor: trazo de 1,5 y sin relleno, como los de Kronos (catálogo Lucide, pero locales: sin red ni librerías).
   Uso: icono('enlace') → cadena <svg> para meter en un innerHTML. El color lo da el texto del botón (currentColor). */
const D = {
  inicio:    '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  directo:   '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>',
  examen:    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 14l2 2 4-4"/>',
  repaso:    '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  ajustes:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  actualizar:'<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  enlace:    '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  probar:    '<path d="M7 4l13 8-13 8z"/>',
  volver:    '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  bajar:     '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/>',
  subir:     '<path d="M12 21V9"/><path d="M7 13l5-5 5 5"/><path d="M5 3h14"/>',
  persona:   '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  aviso:     '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/>',
  ok:        '<path d="M5 12l5 5 9-10"/>',
  cerrar:    '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'
};
export function icono(nombre, tam = 16) {
  return '<svg class="ico" viewBox="0 0 24 24" width="' + tam + '" height="' + tam + '" aria-hidden="true" focusable="false">' + (D[nombre] || '') + '</svg>';
}
