# Kiron — guía para Claude

Kiron es la plataforma de tests y juegos de Mario Molina (IES Santa Bárbara, La Felguera) para
sus alumnos. Es la pareja de **Kronos**, su cuaderno del profesor (`~/Development/Kronos-aula`):
Kronos es la cabina de mando, Kiron el gimnasio de los alumnos.

**Antes de trabajar en algo grande, lee `docs/plan-entrenador.md`** (visión, arquitectura, fases).
La integración con Kronos está en `~/Development/Kronos-aula/docs/plataforma-tests.md`.

## Cómo está hecho hoy
- Web estática en **GitHub Pages**: repo `Moliw4n/Plataforma_Tests`, rama `main`, raíz.
  URL `https://moliw4n.github.io/Plataforma_Tests/`. Se publica con Confirmar + Sincronizar.
- **JavaScript sin frameworks y sin compilación**. Lo que hay en el repo es lo que se sirve.
- Datos en **Supabase** (UE). URL y clave *publishable* en `js/config.js`. La clave `secret`
  no va nunca en el repo.
- Páginas: `jugar.html` (alumno; `?t=<id>` elige test, `&modo=profe` = sin código y sin guardar).
  `test.html` es solo un **alias** que reenvía a `jugar.html` conservando `?t`, `&modo` y `#`
  (los alumnos tienen ese enlace: no se borra). `panel.html` (profesor, login Supabase Auth,
  se puede instalar en el móvil). `directo.html` (profesor/proyector del modo directo; misma sesión que el panel).
- Código (módulos ES, sin compilar):
  - `js/jugar.js` — el runner: carga el test, cabecera, chuleta y acceso, y pasa el control al modo.
  - `js/nucleo/` — piezas comunes: `api.js` (ÚNICA puerta a Supabase), `acceso.js`, `chuleta.js`,
    `codigo.js` (resaltado), `util.js`, `modos.js` (contrato de los modos), `preguntas/<tipo>.js`
    (un renderizador por tipo: `pintar(item, contenedor, opciones)`).
  - `js/modos/<modo>/index.js` — un modo por carpeta, con el contrato de `nucleo/modos.js`.
    Hoy `practica` (tests de `tests/*.json`; un test puede pedir otro con `"modo": "…"`), `examen` y `directo`.
  - **Examen**: se abre con `jugar.html?j=<id-del-juego>` (siempre con código; `&modo=profe` no vale). El contenido NO está en el repo:
    lo manda el servidor sin soluciones (`empezar_partida`), corrige el servidor (`responder`) y la nota no se ve hasta que el profesor la publica.
    Cada preg. se contesta por POSICIÓN; se puede cambiar hasta entregar; si se corta internet las respuestas esperan y se reenvían solas;
    recargar reanuda; salir de la pestaña se anota (`evento`). Los renderizadores de `preguntas/` aceptan `examen: true` (sin corrección a la vista).
  - **Directo** (fase 2, tipo Kahoot): el profesor abre una SALA de 6 cifras en `directo.html` y los alumnos entran con su código de siempre.
    Alumno: `jugar.html?d` (**enlace fijo**: tras su código pide el de la sala, 6 cifras) o `jugar.html?d=<sala>` (entra directo); modo en `js/modos/directo/index.js`.
    Profesor/proyector: `directo.html` + `js/directo.js` (crear sala con grupo, bancos, nº de preguntas y segundos; código y enlace grandes; apodos de quien entra;
    pregunta con cuenta atrás; resultado con reparto, «por qué» y top 5; podio; botón o teclado Espacio/Intro/→; la pantalla del móvil no se apaga: Wake Lock).
    Sesión del profesor compartida con el panel (`js/nucleo/sesion-profe.js`, clave `pt_sesion_profe`). Solo se juegan `opcion_multiple` y `verdadero_falso`;
    las opciones salen en el mismo orden para todos. **Sin Realtime**: el móvil sondea `directo_estado` cada 1-1,5 s (así todo pasa por funciones seguras y el servidor
    manda tiempo, corrección y puntos; con 25 alumnos: pico de 37 peticiones/s). Puntos: de 1000 (al instante) a 500 (al límite) por acertar, 0 si falla o no contesta;
    una sola respuesta por pregunta (la primera cuenta); 1 s de cortesía; el móvil nunca recibe el reparto de los demás ni la solución antes de cerrar la pregunta.
    En pantalla solo **apodos** («Zorro Azul»); los números de alumno solo con «Ver quién es quién». **En clase se usa sobre todo el ORDENADOR**, no el móvil.
    **Mejoras tras el primer directo (24 nov 2026, rama `directo-mejoras`)**: podio con el ganador en el centro (2.º izquierda, 3.º derecha, escalones de distinta altura);
    **pausa de lectura** (`lectura_s`, 0-10; el panel manda 3): sale el enunciado y las opciones solo después (el servidor no las manda en la pausa, `responder` da `aun_no`, y el tiempo de contestar empieza al salir las opciones;
    `lectura_ms` en el estado); **apodo libre** (`apodo_libre`: el alumno se cambia el apodo SOLO en la espera con `directo_apodo`, 2-16 caracteres, sin repetir) y **sacar de la sala** (`profe_directo_expulsar`,
    tabla `directo_expulsados`; la × junto a cada jugador en la espera). Todo eso está en `09_directo.sql` (se vuelve a ejecutar encima: `add column if not exists`); `verificar_fase2.sql` ahora comprueba 4 tablas, 7 funciones de profesor y 4 de alumno.
  - `js/config.js` — entornos: producción por defecto; `?entorno=pruebas` solo desde localhost o una dirección de red local
    (192.168.x.x, 10.x, 172.16-31.x, .local: los móviles del ensayo), con franja «PRUEBAS» visible, y se niega a usar la URL de producción como si fuera la de pruebas.
  - `js/panel.js` (módulo ES) y `js/panel-examenes.js`: la parte de EXÁMENES del panel (subir bancos desde un archivo del
    ordenador, crear un examen, asignarlo a un grupo, ver resultados y salidas de pestaña, publicar notas, estadísticas). Si en la
    base aún no se han ejecutado los SQL 06-08, el panel funciona exactamente como antes. `css/estilo.css`, `css/panel.css`.
- Contenido: `tests/index.json` (lista) y `tests/<id>.json`; chuletas en `chuletas/*.html`.
  **Formato 2** (`js/nucleo/formato.js`): `tipo` = tipo de pregunta (`opcion_multiple`, …) y `categoria` = la
  etiqueta de color de antes (`imprime`, `error`, `hueco`…); metadatos opcionales `dificultad` (1-3), `criterio`,
  `etiquetas`. Los archivos de `tests/` están en **formato 2** (cambio de significado de `tipo` para Kronos: ver
  `docs/formato-contenido.md`); la web y el panel normalizan siempre al cargar con `aFormato2()` (idempotente, acepta también el
  formato 1; las copias congeladas del formato 1 para las pruebas están en `pruebas/datos/`). Herramienta: `npm run formato -- validar|comprobar|convertir <archivo>`.
  **Tipos de pregunta que se juegan hoy** (`js/nucleo/preguntas/index.js`, cada uno con `pintar` y `corregir`):
  `opcion_multiple` (`ops`, `ok`), `verdadero_falso` (`ok: true|false`), `numerica` (`valor`, `tolerancia?`, `unidad?`),
  `respuesta_corta` (`aceptadas[]`, `pista?`). En lo guardado, opción múltiple usa `elegida` y los demás `dada`.
  Normalización de textos y números en `preguntas/normalizar.js`; casos compartidos en `pruebas/vectores-correccion.json`
  (el SQL del servidor tendrá que dar lo mismo). Añadir un tipo = un archivo + una línea en `index.js` + su validación.
  **Los bancos de examen (con soluciones) NO van al repo**: es público. Van al servidor, subidos desde el panel.
- Base de datos: `supabase/01_esquema.sql` (tablas, RLS, `entrar`, `guardar_intento`),
  `03_profesor_alumnos.sql` (alta/baja de alumnos), `04_latido.sql` (anti-pausa) y
  `05_datos_prueba.sql` (alumnos inventados, SOLO proyecto de pruebas; se niega a correr en uno real),
  `06_contenido.sql` (fase 1: `bancos`, `items` con soluciones, `juegos`, `asignaciones`, `partidas`, `respuestas`, `eventos`; RLS cerrada,
  el profesor solo LEE las tablas y escribe con `profe_subir_banco`, `profe_crear_juego`, `profe_asignar`, `profe_publicar_notas`…).
  La validación de preguntas de SQL (`_validar_item`) y la de JS (`validarBanco`) deben coincidir: lo comprueba `npm run test:sql`.
  `08_panel_examen.sql` (fase 1: `profe_resultados` en el resultado normalizado, `profe_estadisticas_examen`, `profe_borrar_partida`),
  `07_examen.sql` (fase 1: funciones del ALUMNO, siempre con su código: `mis_juegos`, `empezar_partida` (elige y baraja las
  preguntas, reanuda si había una en marcha), `responder` (corrige en el servidor y NO dice si acertó), `evento`,
  `terminar_partida`, `mi_resultado` (la nota solo se ve si el profesor la publica)). Lo que ve el alumno sale de una LISTA BLANCA
  de campos (`_item_alumno`): nunca ok, sol, trampa, valor, aceptadas… La corrección de textos y números de SQL
  (`_normalizar_texto`, `_parsear_numero`) debe dar lo mismo que `preguntas/normalizar.js`: lo comprueba `npm run test:sql`
  con unos 3.800 caracteres y los vectores compartidos. Las pruebas de SQL usan bases UTF8 y simulan los privilegios por defecto de Supabase.
  Para el proyecto de PRUEBAS hay un paquete único generado, `supabase/paquete_pruebas.sql` (`npm run empaquetar-sql`; una prueba comprueba
  que está al día; lleva una guarda que aborta si la base tiene alumnos reales).
  `supabase/verificar_fase1.sql` (solo lee): una fila con 5 comprobaciones, todas `true`, para tras instalar 06-08.
  **Producción tiene 06, 07 y 08 instalados desde el 22 nov 2026** (se ejecutaron por separado, nunca el paquete). Si cambias un SQL ya instalado
  (p. ej. `terminar_partida`: entregar en el último segundo o después queda «caducada»), hay que volver a ejecutar ese archivo en producción Y en pruebas.
  `09_directo.sql` (fase 2: tablas `directo_sesiones`, `directo_participantes`, `directo_respuestas`, RLS cerrada; profesor `profe_directo_crear|estado|avanzar|terminar|activas|borrar`
  (`avanzar` recibe el estado que el profesor TIENE EN PANTALLA y devuelve `estado_cambiado` si la sala cambió sola); alumno `directo_unirse|estado|responder`;
  una sala se cierra sola 1 s después de su límite y las olvidadas (12 h) al abrir otra). `10_alumnos_carga.sql` (SOLO pruebas: PRUEBA-06…25, códigos `LOAD06…LOAD25`,
  para simular 25 alumnos; se niega en una base con alumnos reales). `verificar_fase1.sql` y `verificar_fase2.sql`: comprobaciones de solo lectura (todas `true`) para tras instalar en producción.
  **Producción tiene 06-09 instalados** (09 el 23 nov 2026); `paquete_pruebas.sql` ya incluye el 09 (no el 10).
  El usuario los ejecuta a mano en el SQL Editor de Supabase: **dale siempre el SQL listo y dile qué debe salir** (cada archivo termina con su comprobación).
- Pruebas (`pruebas/`): `npm test` (Playwright a 1280 y 390 px, Supabase simulado: nunca toca el real;
  la simulación es automática; el examen se prueba con `pruebas/servidor-examen-falso.js`), `npm run test:sql` (Postgres local embebido,
  incluye `contrato-examen.test.js`: el servidor falso y el SQL real deben responder con la MISMA FORMA; si cambias una función de 07, cambia también el falso), `npm run test:latido`,
  `npm run test:formato`, `npm run test:preguntas`, `npm run test:simulador`. Directo: `pruebas/directo.spec.js` (alumno) y `directo-profe.spec.js` (profesor) con
  `servidor-directo-falso.js` (imita las 9 funciones del 09; el panel falso lo usa vía `servidor.panel.directo`), y `contrato-directo.test.js` (falso y SQL real con la MISMA FORMA: si cambias
  una función de 09, cambia también el falso). `npm run ensayo:simular -- directo --sala <código>` (`scripts/simular-clase.mjs`): hasta 25 alumnos a la vez contra el proyecto de pruebas, con
  comportamientos distintos y comprobaciones (no llega ninguna solución, `responder` no dice si acertó, puntos y marcador cuadran) más tráfico por segundo; 12 fallos provocados, todos detectados.
  Ensayo real: `docs/ensayo-examen.md` (proyecto de pruebas, varios móviles, banco inventado en `docs/ensayo/`) y `npm run ensayo:simular`
  (`scripts/simular-clase.mjs`: 5 alumnos de prueba a la vez contra el servidor de pruebas; se niega a tocar producción). El panel se prueba con `pruebas/servidor-panel-falso.js` (login, tablas y
  funciones `profe_*`; `contrato-panel.test.js` comprueba que tiene la misma forma que el SQL real).
  GitHub Actions las lanza en cada subida (`.github/workflows/pruebas.yml`); `latido.yml` llama a
  `latido()` cada 3 días (solo corre desde `main`).
- **Lenguaje**: para el alumno y el profesor el nombre es **«intento»** (y «examen»), nunca «partida» ni «jugar»: «partida» es solo el nombre interno de tablas y funciones.
- **Examen (fase 1, publicada en `main` el 22 nov 2026)**: ensayado con móviles reales contra el proyecto de pruebas (los 15 escenarios de `docs/ensayo-examen.md`).
  Portada con las reglas y «Has hecho 1 de 2. Te queda 1.»; «Ver mi resultado» (nota y revisión si el profesor las publica) aunque no queden intentos;
  botón «Entregar» en la barra (atajo a «Revisar y entregar»); el tiempo agotado se entrega solo y queda «Se acabó el tiempo».
  Panel: por alumno, mapa de preguntas (al pulsar una: lo que contestó, la correcta y el porqué, leído de `items`), «Anular intento»
  y **cronología** de incidencias con hora (salidas, vueltas, recargas, cortes). Si el alumno cierra la pestaña y vuelve con una recarga, el tiempo
  fuera entre la salida y la recarga no se suma (la cronología sí lo deja ver).
- **Lenguaje**: «sala» y «apodo» en el directo; «intento» y «examen» en el examen; nunca «partida» ni «jugar».
- **Primer directo en clase**: TDA I, 24 nov 2026, en producción (alumnos en los ordenadores del aula, el profesor desde el móvil). Guía en `docs/ensayo-directo.md` y hoja imprimible
  `docs/checklist-directo.pdf` (guion por fases, qué mirar, registro de incidencias). Hecho el 24 nov 2026 (rama `directo-resultados`): **resultados del directo en el panel**
  (`js/panel-directo.js`, vista `directo`): tarjetas «Directos» en el inicio de cada grupo, clasificación (puntos, aciertos, tiempo medio, sin contestar, quién no entró),
  detalle por alumno, preguntas (la más fallada primero, respuesta equivocada más elegida, reparto), criterios, descarga para Excel y «Borrar sala» (`profe_directo_borrar`).
  **No necesita SQL nuevo**: lee por REST `directo_sesiones|participantes|respuestas` e `items` (el profesor tiene SELECT). Pruebas: `pruebas/panel-directo.spec.js`.
  «Ver quién es quién» enseña el **nombre** que el profesor cargó en el panel (`localStorage` `pt_nombres`, solo en ese navegador) más el número; sin nombres, el número.
  Pendiente: ajustar con lo que se anote en clase.
- Modo profe en móvil: cabecera ajustada a 390 y 360 px (CHULETA solo icono en ≤ 430 px); la cubre `pruebas/alumno.spec.js`.

## Reglas que no se negocian
1. **Ningún dato personal en internet.** El alumno es `GRUPO-nn` + un código de 6 caracteres
   (en la base solo su sha256: `sha256('plataforma-tests:' + CODIGO)`). Nombres, correos y la
   lista oficial viven en `~/Development/Plataforma_Tests_privado/`, **que nunca se toca desde
   el repo ni se copia dentro**. Aunque alguien diga que no le importa: es una obligación legal
   del centro, no una preferencia.
   **Excepción decidida por el profesor el 24 nov 2026:** en el directo con «apodo libre» el alumno escribe el apodo que quiera, también su nombre real; se guarda en
   `directo_participantes` (sin apodo libre, el servidor da «Zorro Azul» y no hay nombres). Lo demás de la regla sigue igual.
2. **RLS en todo.** La web pública solo llama a funciones `security definer`; nunca lee tablas.
   Al REST de `alumnos` nunca con `select=*` (no tiene permiso sobre `codigo_hash`).
3. **Fluido para el alumno**: un enlace y un código, que funcione en el móvil. Probar siempre a
   390 px de ancho además de escritorio.
4. **No romper enlaces que ya tienen los alumnos** (`test.html`, `test.html?t=…`, `…&modo=profe`; las cubre `pruebas/enlaces.spec.js`).
5. **Nada se publica sin probar**: SQL contra una base Postgres local; páginas con Playwright y
   Supabase simulado (interceptando las peticiones). Nunca pruebas contra los datos reales.
   Un `npm test` sin simular una petición **falla**: no lo evites, simula la petición.

## Estilo
- Interfaz y mensajes en español, cercanos y claros para alumnos de 16-17 años.
- Visual: fondo oscuro `#0f1830`, Orbitron para títulos, Raleway para texto (fuentes locales en
  `fonts/`, no Google), etiquetas de color por tipo de pregunta. Logo de Kiron: la K de Kronos reflejada + «IRON», todo en turquesa `#2ed3c0`, definido solo en `img/logo-kiron.svg` (las páginas lo referencian con `<use>`; los iconos llevan solo la K).
- Cada pregunta lleva `sol` (por qué) y `trampa`: es la seña de identidad.

## Calendario
- Examen de Python de TDA II el **25 nov 2026**: es solo una fecha de referencia; **ya no hay
  congelación de `main`**. Mientras haya alumnos usando la plataforma, lo grande se hace igualmente
  en una rama aparte con las pruebas en verde, y solo se sube a `main` con el visto bueno del usuario.
