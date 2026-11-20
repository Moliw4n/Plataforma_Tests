# Kairos — guía para Claude

Kairos es la plataforma de tests y juegos de Mario Molina (IES Santa Bárbara, La Felguera) para
sus alumnos. Es la pareja de **Kronos**, su cuaderno del profesor (`~/Development/Kronos-aula`):
Kronos es la cabina de mando, Kairos el gimnasio de los alumnos.

**Antes de trabajar en algo grande, lee `docs/plan-entrenador.md`** (visión, arquitectura, fases).
La integración con Kronos está en `~/Development/Kronos-aula/docs/plataforma-tests.md`.

## Cómo está hecho hoy
- Web estática en **GitHub Pages**: repo `Moliw4n/Plataforma_Tests`, rama `main`, raíz.
  URL `https://moliw4n.github.io/Plataforma_Tests/`. Se publica con Confirmar + Sincronizar.
- **JavaScript sin frameworks y sin compilación**. Lo que hay en el repo es lo que se sirve.
- Datos en **Supabase** (UE). URL y clave *publishable* en `js/config.js`. La clave `secret`
  no va nunca en el repo.
- Páginas: `test.html` (alumno; `?t=<id>` elige test, `&modo=profe` = sin código y sin guardar),
  `panel.html` (profesor, login Supabase Auth, se puede instalar en el móvil).
- Código: `js/test.js`, `js/panel.js`, `css/estilo.css`, `css/panel.css`.
- Contenido: `tests/index.json` (lista) y `tests/<id>.json`; chuletas en `chuletas/*.html`.
- Base de datos: `supabase/01_esquema.sql` (tablas, RLS, `entrar`, `guardar_intento`) y
  `supabase/03_profesor_alumnos.sql` (alta/baja de alumnos por el profesor). El usuario los
  ejecuta a mano en el SQL Editor de Supabase: **dale siempre el SQL listo y dile qué debe salir**.

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
4. **No romper enlaces que ya tienen los alumnos** (`test.html`, `test.html?t=…`).
5. **Nada se publica sin probar**: SQL contra una base Postgres local; páginas con Playwright y
   Supabase simulado (interceptando las peticiones). Nunca pruebas contra los datos reales.

## Estilo
- Interfaz y mensajes en español, cercanos y claros para alumnos de 16-17 años.
- Visual: fondo oscuro `#0f1830`, Orbitron para títulos, Raleway para texto (fuentes locales en
  `fonts/`, no Google), etiquetas de color por tipo de pregunta. Logo `KAIR0S` con el cero naranja.
- Cada pregunta lleva `sol` (por qué) y `trampa`: es la seña de identidad.

## Calendario
- Examen de Python de TDA II el **25 nov 2026**. Hasta entonces, cambios grandes en una rama
  aparte; en `main` solo arreglos pequeños.
