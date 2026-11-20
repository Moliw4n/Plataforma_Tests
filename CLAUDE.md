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
    Hoy solo `practica`. Un test puede pedir otro con `"modo": "…"`; sin él, `practica`.
  - `js/config.js` — entornos: producción por defecto; `?entorno=pruebas` solo desde localhost.
  - `js/panel.js`, `css/estilo.css`, `css/panel.css`.
- Contenido: `tests/index.json` (lista) y `tests/<id>.json`; chuletas en `chuletas/*.html`.
- Base de datos: `supabase/01_esquema.sql` (tablas, RLS, `entrar`, `guardar_intento`),
  `03_profesor_alumnos.sql` (alta/baja de alumnos), `04_latido.sql` (anti-pausa) y
  `05_datos_prueba.sql` (alumnos inventados, SOLO proyecto de pruebas; se niega a correr en uno real).
  El usuario los ejecuta a mano en el SQL Editor de Supabase: **dale siempre el SQL listo y dile qué debe salir**.
- Pruebas (`pruebas/`): `npm test` (Playwright a 1280 y 390 px, Supabase simulado: nunca toca el real;
  la simulación es automática), `npm run test:sql` (Postgres local embebido), `npm run test:latido`.
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
- Examen de Python de TDA II el **25 nov 2026**. Hasta entonces, cambios grandes en una rama
  aparte; en `main` solo arreglos pequeños.
