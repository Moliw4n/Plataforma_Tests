/* Conexión con Supabase. Esta clave es la "publishable": está pensada para ir
   en una web pública. La seguridad la ponen las reglas RLS de la base de datos.
   La clave "secret" NUNCA va aquí.

   ENTORNOS: por defecto se usa el de producción (el de los alumnos). El proyecto de PRUEBAS solo se activa
   con ?entorno=pruebas y SOLO si la página se abre desde tu ordenador (localhost) o desde una dirección de
   red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x o nombre.local: así los móviles del ensayo, en la misma WiFi,
   pueden usarlo). Desde la web pública (github.io) no hay forma de activarlo: esas direcciones no se pueden
   alcanzar desde internet. Cuando está activo se ve una franja «PRUEBAS» y NUNCA se usa la URL de producción. */
(function () {
  var ENTORNOS = {
    produccion: {
      supabaseUrl: 'https://vltooganezktrqduwhzy.supabase.co',
      supabaseKey: 'sb_publishable_OjurBy5nEKkHHuu2WVk2eQ_gTeDlML4'
    },
    // Proyecto de PRUEBAS de Supabase (kiron-pruebas): datos inventados. La URL y la clave «publishable» son públicas por diseño.
    // IMPORTANTE: va DESPUÉS de producción (scripts como el latido leen la primera URL del archivo).
    pruebas: {
      supabaseUrl: 'https://mjqdfpmozslarfqwnwee.supabase.co',
      supabaseKey: 'sb_publishable_RxOaHwmhF_U4cpNT6MwKLQ_4PmsQDiA'
    }
  };
  var local = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local)$/i.test(location.hostname);
  var pedido = new URLSearchParams(location.search).get('entorno');
  var nombre = local && pedido === 'pruebas' ? 'pruebas' : 'produccion';
  window.ENTORNO = nombre;
  // Un descuido al copiar (poner la URL de producción en «pruebas») no puede acabar tocando los datos de los alumnos
  if (nombre === 'pruebas' && ENTORNOS.pruebas && ENTORNOS.pruebas.supabaseUrl === ENTORNOS.produccion.supabaseUrl) {
    console.error('Kiron: el entorno de pruebas apunta a la URL de PRODUCCIÓN. Sin conexión a Supabase.');
    ENTORNOS.pruebas = null;
  }
  if (!ENTORNOS[nombre]) {
    // Pidieron pruebas pero no está configurado: mejor sin conexión que tocar los datos reales.
    console.warn('Kiron: el entorno «' + nombre + '» no está configurado. Sin conexión a Supabase.');
    window.CONFIG = null;
  } else window.CONFIG = ENTORNOS[nombre];
  // Franja visible mientras se usa el proyecto de pruebas (para no confundirlo nunca con el de verdad)
  if (nombre === 'pruebas' && typeof document !== 'undefined') {
    var franja = function () {
      var d = document.createElement('div');
      d.id = 'franja-pruebas'; d.textContent = 'PRUEBAS · datos de ensayo';
      d.style.cssText = 'position:fixed;left:50%;bottom:4px;transform:translateX(-50%);z-index:99999;background:#ffc145;color:#0b1226;font:800 11px/1 Orbitron,sans-serif;letter-spacing:.1em;padding:5px 12px;border-radius:99px;pointer-events:none;opacity:.92';
      document.body.appendChild(d);
    };
    if (document.body) franja(); else document.addEventListener('DOMContentLoaded', franja);
  }
})();
