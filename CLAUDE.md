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
  se puede instalar en el móvil).
- Código (módulos ES, sin compilar):
  - `js/jugar.js` — el runner: carga el test, cabecera, chuleta y acceso, y pasa el control al modo.
  - `js/nucleo/` — piezas comunes: `api.js` (ÚNICA puerta a Supabase), `acceso.js`, `chuleta.js`,
    `codigo.js` (resaltado), `util.js`, `modos.js` (contrato de los modos), `preguntas/<tipo>.js`
    (un renderizador por tipo: `pintar(item, contenedor, opciones)`).
  - `js/modos/<modo>/index.js` — un modo por carpeta, con el contrato de `nucleo/modos.js`.
    Hoy `practica` (tests de `tests/*.json`; un test puede pedir otro con `"modo": "…"`) y `examen`.
  - **Examen**: se abre con `jugar.html?j=<id-del-juego>` (siempre con código; `&modo=profe` no vale). El contenido NO está en el repo:
    lo manda el servidor sin soluciones (`empezar_partida`), corrige el servidor (`responder`) y la nota no se ve hasta que el profesor la publica.
    Cada preg. se contesta por POSICIÓN; se puede cambiar hasta entregar; si se corta internet las respuestas esperan y se reenvían solas;
    recargar reanuda; salir de la pestaña se anota (`evento`). Los renderizadores de `preguntas/` aceptan `examen: true` (sin corrección a la vista).
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
  El usuario los ejecuta a mano en el SQL Editor de Supabase: **dale siempre el SQL listo y dile qué debe salir**.
- Pruebas (`pruebas/`): `npm test` (Playwright a 1280 y 390 px, Supabase simulado: nunca toca el real;
  la simulación es automática; el examen se prueba con `pruebas/servidor-examen-falso.js`), `npm run test:sql` (Postgres local embebido,
  incluye `contrato-examen.test.js`: el servidor falso y el SQL real deben responder con la MISMA FORMA; si cambias una función de 07, cambia también el falso), `npm run test:latido`,
  `npm run test:formato`, `npm run test:preguntas`, `npm run test:simulador`.
  Ensayo real: `docs/ensayo-examen.md` (proyecto de pruebas, varios móviles, banco inventado en `docs/ensayo/`) y `npm run ensayo:simular`
  (`scripts/simular-clase.mjs`: 5 alumnos de prueba a la vez contra el servidor de pruebas; se niega a tocar producción). El panel se prueba con `pruebas/servidor-panel-falso.js` (login, tablas y
  funciones `profe_*`; `contrato-panel.test.js` comprueba que tiene la misma forma que el SQL real).
  GitHub Actions las lanza en cada subida (`.github/workflows/pruebas.yml`); `latido.yml` llama a
  `latido()` cada 3 días (solo corre desde `main`).
- Modo profe en móvil: cabecera ajustada a 390 y 360 px (CHULETA solo icono en ≤ 430 px); la cubre `pruebas/alumno.spec.js`.

## Reglas que no se negocian
1. **Ningún dato personal en internet.** El alumno es `GRUPO-nn` + un código de 6 caracteres
   (en la base solo su sha256: `sha256('plataforma-tests:' + CODIGO)`). Nombres, correos y la
   lista oficial viven en `~/Development/Plataforma_Tests_privado/`, **que nunca se toca desde
   el repo ni se copia dentro**. Aunque alguien diga que no le importa: es una obligación legal
   del centro, no una preferencia.
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
