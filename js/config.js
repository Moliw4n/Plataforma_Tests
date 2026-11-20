/* Conexión con Supabase. Esta clave es la "publishable": está pensada para ir
   en una web pública. La seguridad la ponen las reglas RLS de la base de datos.
   La clave "secret" NUNCA va aquí.

   ENTORNOS: por defecto se usa el de producción (el de los alumnos). El proyecto de PRUEBAS
   solo se activa abriendo la página desde tu ordenador (localhost) con ?entorno=pruebas.
   Desde la web pública (github.io) no hay forma de activarlo. */
(function () {
  var ENTORNOS = {
    produccion: {
      supabaseUrl: 'https://vltooganezktrqduwhzy.supabase.co',
      supabaseKey: 'sb_publishable_OjurBy5nEKkHHuu2WVk2eQ_gTeDlML4'
    },
    // Se rellena cuando exista el proyecto de pruebas (fase 0, paso 6).
    pruebas: null
  };
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var pedido = new URLSearchParams(location.search).get('entorno');
  var nombre = local && pedido === 'pruebas' ? 'pruebas' : 'produccion';
  window.ENTORNO = nombre;
  if (!ENTORNOS[nombre]) {
    // Pidieron pruebas pero no está configurado: mejor sin conexión que tocar los datos reales.
    console.warn('Kairos: el entorno «' + nombre + '» no está configurado. Sin conexión a Supabase.');
    window.CONFIG = null;
  } else window.CONFIG = ENTORNOS[nombre];
})();
