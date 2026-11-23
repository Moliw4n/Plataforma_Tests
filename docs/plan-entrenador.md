# Kiron (el Entrenador) — plan de reorganización y de juegos

> **Nombre**: La plataforma se llama Kiron (Quirón, en griego Kheiron). En la mitología es hijo de Kronos y el gran entrenador de héroes: educó a Aquiles, Jasón y Asclepio. Kronos es el cuaderno del profesor; Kiron entrena a los alumnos, que son los héroes en formación.

> Documento de planificación (20 nov 2026). Recoge la ambición del proyecto y lo que hay que
> hacer **antes** de construir juegos para que cada juego nuevo sea poco trabajo.
> Para Claude Code: leer entero antes de tocar nada; se trabaja por fases y cada fase se
> cierra con pruebas pasando y una pasada del usuario.

## 1. La visión

**Kronos es la cabina de mando del profesor. El Entrenador es el gimnasio de los alumnos.**

- El Entrenador no es «una web de tests»: es una **plataforma de modos de juego** que usan el
  mismo contenido. Un banco de preguntas de Python sirve para practicar, para un examen, para
  un Kahoot en clase, para un rosco o para una sala de escape room, sin reescribirlo.
- La ambición, sin recortes: práctica, examen, directo tipo Kahoot, rosco tipo Pasapalabra,
  escape room, duelos, carreras por equipos, tarjetas con repaso espaciado, «quién quiere
  ser millonario», retos diarios… y una capa de gamificación (puntos, niveles, insignias,
  rachas) por encima de todo.
- Kronos decide (qué alumnos, qué juego, a qué clase, cuándo, qué criterio evalúa) y recibe
  los resultados. El Entrenador ejecuta.

## 2. Principios (no se negocian al crecer)

1. **Fluido para el alumno, sin excusas.** Un enlace, un código, funciona en el móvil.
2. **Sin datos personales en internet.** El alumno es un número (`TDA2-07`) y un código. Los
   nombres solo existen en Kronos y en el panel del profesor, cargados en local. En rankings y
   juegos en directo el alumno aparece con un **apodo generado** («Zorro Azul») o con su
   equipo, nunca con su nombre.
3. **Cuando cuenta, la solución no viaja al alumno.** En práctica se puede (la corrección es
   inmediata y es parte del aprendizaje). En examen, directo y juegos con puntos, **se corrige
   en el servidor**.
4. **Un arreglo sirve para todos.** Las piezas comunes (entrada, dibujar una pregunta, chuleta,
   guardar, sonidos y animaciones) existen una sola vez.
5. **Nada se publica sin pruebas.** Cada modo tiene sus pruebas automáticas.

## 3. Arquitectura por capas

```
          Kronos (cabina)               Panel web (móvil del profe)
                 \                        /
                  \                      /
             ┌──── Supabase (servidor) ────┐
             │ alumnos · bancos · juegos   │
             │ asignaciones · resultados   │
             │ directo (Realtime) · logros │
             └──────────────┬──────────────┘
                            │
    ┌───────────────────────┴───────────────────────┐
    │              EL ENTRENADOR (web)               │
    │  MODOS: práctica · examen · directo · rosco ·  │
    │         escape room · duelo · tarjetas · …     │
    │  NÚCLEO: acceso · api · preguntas · chuleta ·  │
    │          guardado · sonido/animación · logros  │
    └────────────────────────────────────────────────┘
```

### 3.1 Núcleo (`js/nucleo/`)
- `acceso.js` — código del alumno, apodo, «no soy yo». Modo profesor.
- `api.js` — todas las llamadas a Supabase (RPC, REST, Realtime). Reintentos y errores claros.
- `preguntas/` — **un renderizador por tipo de pregunta** (ver 4.2), con la misma interfaz:
  `pintar(item, contenedor, opciones) → { respuesta(), bloquear(), mostrarCorreccion(c) }`.
- `chuleta.js`, `codigo.js` (resaltado de Python y otros), `sonido.js`, `animacion.js`.
- `logros.js` — puntos, insignias, rachas (fase 5).

### 3.2 Modos (`js/modos/<modo>/`)
Cada modo es una carpeta con un **contrato común**:
```js
export default {
  id: 'rosco',
  nombre: 'Rosco',
  necesita: { directo: false, servidor: true },      // qué capacidades usa
  tiposPregunta: ['respuesta_corta'],               // qué tipos sabe jugar
  async iniciar(ctx) {},   // ctx = { alumno, juego, contenido, api, nucleo, contenedor }
  async terminar() {}      // devuelve el resultado normalizado (ver 5.3)
}
```
Una sola página (`jugar.html?j=<juegoId>`) carga el modo que diga el juego. Añadir un juego
nuevo = una carpeta nueva en `modos/`, sin tocar el resto.

### 3.3 Páginas
- `jugar.html` — alumno (sustituye a `test.html`, que se queda como alias para no romper enlaces).
- `directo.html` — pantalla del profesor y del proyector para el modo directo (crear sala, código, preguntas, resultado, podio). Los alumnos entran por `jugar.html?d` (enlace fijo) o `jugar.html?d=<sala>`.
- `panel.html` — panel web del profesor (móvil).

## 4. El contenido

### 4.1 Bancos y juegos (separados)
- **Banco**: colección de ítems sobre un tema (`python-u1`, `tda1-u1u2`). Cada ítem lleva
  metadatos: `tema`, `criterio` (de Kronos), `dificultad` (1-3), `etiquetas`.
- **Juego**: una configuración que usa uno o varios bancos con unas reglas:
  `{ id, modo:'rosco', bancos:['python-u1'], reglas:{ tiempo:240, … }, grupo, desde, hasta }`.
- Las **prácticas** pueden seguir en archivos públicos (`tests/*.json`), como ahora.
  Los bancos de **examen y de juegos con puntos** viven en Supabase, en tablas que el alumno
  no puede leer; el alumno recibe el ítem **sin la solución** y la corrección la hace una
  función del servidor.

### 4.2 Tipos de pregunta (ampliables)
| tipo | ejemplo | lo que necesita |
|---|---|---|
| `opcion_multiple` | las de ahora (4 opciones, D fija opcional) | `ops`, `ok` |
| `verdadero_falso` | «UTF-8 usa siempre 1 byte» | `ok: true/false` |
| `respuesta_corta` | rosco: «Empieza por R: memoria que se borra al apagar» | `aceptadas: ['ram', 'memoria ram']`, normalizar acentos y mayúsculas |
| `numerica` | «¿Cuánto vale 2F en decimal?» | `valor`, `tolerancia` |
| `ordenar` | ordenar los pasos del diagnóstico | `elementos` en su orden correcto |
| `emparejar` | sistema de archivos ↔ característica | `pares` |
| `huecos` | completar código o texto | `huecos` con sus respuestas aceptadas |
| `codigo` | escribir un programa y ejecutarlo (Python en el navegador, Pyodide) | casos de prueba |

Cada ítem conserva `sol` (por qué) y `trampa`, que son la seña de identidad del Entrenador.

### 4.3 Formato y versión
Todo el contenido lleva `formato: 2`. Un conversor pasa los tests actuales (`formato` 1) al
nuevo sin perder nada.

## 5. El servidor (Supabase)

### 5.1 Tablas nuevas (todas con RLS, el alumno no lee ninguna)
- `bancos`, `items` — contenido privado (con soluciones).
- `juegos` — configuración y reglas; `asignaciones` (juego ↔ grupo, fechas, intentos, si se
  muestran soluciones).
- `partidas` — una por alumno y juego (sustituye y amplía a `intentos`); `respuestas` — una
  fila por respuesta (para estadísticas por pregunta y por criterio).
- `directo_sesiones`, `directo_participantes` — partidas en directo (código de sala de 6 cifras).
- `apodos` (alumno → apodo generado), `logros` (puntos, insignias, rachas).

### 5.2 Funciones del servidor (la única puerta del alumno)
`entrar` · `mis_juegos` (lo asignado y abierto) · `empezar_partida` (devuelve ítems sin
solución) · `responder` (corrige y devuelve si acertó, según las reglas del juego) ·
`terminar_partida` · `mi_progreso` (sus notas y su progreso por criterios, sin nada de nadie más).

### 5.3 Resultado normalizado (lo que lee Kronos)
Cualquier modo termina en lo mismo: `{ partida, alumno, juego, nota 0-10, puntos, segundos,
por_criterio: { '2.1': 0.8, … }, respuestas:[…] }`. Así Kronos importa igual un examen que un
rosco, y **cada juego alimenta la nota por criterios**.

### 5.4 Directo (Kahoot y similares)
- Supabase Realtime: un canal por sala; **Broadcast** para las preguntas y el marcador,
  **Presence** para saber quién está conectado. El servidor decide el tiempo y corrige; los
  móviles solo envían la respuesta.
- Límite del plan gratuito: 200 conexiones simultáneas y 100 mensajes por segundo. Una clase
  de 25 está muy por debajo; dos clases a la vez, también.
- **Decisión tomada en la fase 2 (23 nov 2026): SIN Realtime, por ahora.** Cada dispositivo sondea `directo_estado` cada 1-1,5 s. Motivos: (1) con Broadcast abierto cualquiera que sepa el código de
  sala podría mandar mensajes falsos, y así corrección, tiempos y puntos son siempre del servidor y todo pasa por funciones `security definer` como en el examen; (2) no hay una pieza más que
  mantener ni un límite de conexiones; (3) el coste real es pequeño: 25 alumnos simulados → media de 19 y pico de 37 peticiones/s, 95 % bajo 182 ms, ninguna fallida. **Revisar** si en alguna
  clase se nota lag o si hay varias clases a la vez: Realtime podría añadirse solo como aviso de «hay novedades» (el estado seguiría llegando por las funciones).

## 6. Decisión tecnológica

- **Se mantiene JavaScript sin frameworks y sin compilación**, con módulos ES
  (`<script type="module">`), igual que Kronos. GitHub Pages sigue sirviendo los archivos tal cual.
- **Punto de revisión obligatorio**: al terminar el segundo modo en directo. Si para entonces
  la interfaz de los juegos se ha vuelto difícil de mantener (mucho estado cambiante, pantallas
  que se repintan a trozos), se pasa a **Svelte + Vite**, con publicación automática mediante
  GitHub Actions. El núcleo y el servidor no cambian; solo la capa de pantallas.
- Animaciones y sonido: CSS y Web Audio, sin librerías pesadas. Gráficos sencillos en SVG.

## 7. Operativa

- **Pausa del plan gratuito**: Supabase pausa un proyecto gratuito tras una semana sin
  actividad (vacaciones). Solución: una tarea programada de GitHub Actions que cada 3 días
  llama a una función `latido()` que escribe una fila. Y, si un día se pausa, reactivarlo
  desde el panel de Supabase.
- **Entorno de pruebas**: el plan gratuito permite dos proyectos. El segundo es el de pruebas;
  `config.js` elige uno u otro. Nada se prueba contra los datos de los alumnos.
- **Pruebas automáticas**: Playwright (navegador real) para cada modo, en GitHub Actions al
  subir cambios. SQL probado con una base local.
- **Publicar**: como ahora, VS Code → Confirmar → Sincronizar. Si las pruebas fallan en
  GitHub, no se publica.

## 8. Hoja de ruta

| Fase | Qué | Para qué |
|---|---|---|
| **0. Reorganización** · *hecha y publicada en `main` el 20 nov 2026* | Núcleo en módulos, contrato de modos, `jugar.html`, práctica como primer modo, pruebas Playwright, latido anti-pausa, proyecto de pruebas | Que todo lo demás sea barato. El alumno no nota nada. |
| **1. Contenido en el servidor + examen** · *hecha y publicada en `main` el 22 nov 2026* | Bancos e ítems en Supabase, tipos de pregunta nuevos, `partidas`/`respuestas`, modo examen (20 al azar equilibradas, un intento, tiempo, registro de salidas de pestaña, nota oculta hasta publicarla) | Exámenes sin soluciones a la vista. |
| **2. Directo** · *en `main` desde el 23 nov 2026; primer uso en clase (TDA I) el 24 nov* | Modo Kahoot: sala con código, proyector, móviles, marcador con apodos, podio | El primer juego en clase. |
| **3. Rosco** | Pasapalabra con letras, tiempo y «pasapalabra»; respuesta corta con normalización | Primer juego individual con otro tipo de pregunta. |
| **4. Escape room** | Salas con candados: cada candado se abre con un código que sale de resolver retos; pistas con penalización; por equipos | El más ambicioso: valida que el contrato de modos aguanta. |
| **5. Gamificación** | Puntos, niveles, insignias, rachas, retos diarios, «mi progreso» por criterios para el alumno | Que vuelvan sin que se lo pidas. |
| **En paralelo** | Kronos: alumnos y códigos → importar resultados → ver resultados → asignar juegos y criterios desde Kronos | La cabina de mando. |

Cada fase deja algo usable en clase. Ninguna rompe lo anterior: los enlaces que ya tienen los
alumnos siguen funcionando.

### Estado de la fase 0
Hecho (publicado en `main`, 20 nov 2026): núcleo en módulos (`js/nucleo/`), contrato de modos (`nucleo/modos.js`) con la
práctica como primer modo (`js/modos/practica/`), `jugar.html` con `test.html` como alias, entornos
en `config.js`, pruebas Playwright + SQL + latido, `04_latido.sql`, `05_datos_prueba.sql` y GitHub
Actions. Lo que quedaba fuera (`formato: 2`, `jugar.html?j=<juego>` y el proyecto de pruebas en `config.js`) se hizo en la fase 1.

### Estado de la fase 1
Hecho (publicado en `main` el 22 nov 2026; SQL 06, 07 y 08 instalados en producción): `formato: 2` y el conversor (`npm run formato`), cuatro tipos de
pregunta jugables (`opcion_multiple`, `verdadero_falso`, `numerica`, `respuesta_corta`), bancos con soluciones solo en Supabase (subidos desde el panel),
`jugar.html?j=<juego>` con el modo examen (preguntas al azar equilibradas por tema, tiempo y corrección en el servidor, respuestas por posición, reanudar al recargar,
cola de reintentos sin internet, salidas de pestaña anotadas, nota oculta hasta publicarla) y la gestión de exámenes en el panel (subir bancos, crear, asignar con fechas
opcionales, resultados con cronología de incidencias, estadísticas por pregunta, publicar notas, anular intento, exportar a Excel). Ensayada con móviles reales contra el
proyecto de pruebas (`docs/ensayo-examen.md`, 15 escenarios). **Pendiente / ideas**: sumar al tiempo fuera el que pasa entre una salida y una recarga, un examen real
subido desde el panel, y la fase 2 (directo).

### Estado de la fase 2
Hecho (en `main` el 23 nov 2026; SQL 09 en producción): salas con código de 6 cifras (`09_directo.sql`: tablas cerradas por RLS, 6 funciones del profesor y 3 del alumno), modo `directo` del
alumno (`jugar.html?d` con **enlace fijo** o `?d=<sala>`; apodos generados por el servidor; una respuesta por pregunta; puntos de 1000 a 500 según la rapidez, medida por el servidor; recarga y cortes
de internet tolerados), pantalla del profesor/proyector `directo.html` (misma sesión que el panel; teclado o botón; pantalla del móvil siempre encendida) y sondeo en vez de Realtime (ver 5.4).
Pruebas: batería de navegador a 390 y 1280 px, SQL local con sabotajes, contrato falso↔SQL y **simulador de clase de 25 alumnos** contra el proyecto de pruebas (`10_alumnos_carga.sql`).
Primer directo real con alumnos: TDA I, 24 nov 2026 (guía `docs/ensayo-directo.md`, hoja imprimible `docs/checklist-directo.pdf`). **Pendiente:** ajustes con lo que salga de esa clase; **resultados
del directo en el panel** (puntos por alumno y por criterios, resultado normalizado de 5.3); borrar salas desde la interfaz; opcional: tipos `numerica` y `respuesta_corta` (mejor en el Rosco), QR de la sala.

## 9. Riesgos y cómo se cubren

- **Abarcar demasiado a la vez** → la fase 0 primero, sin juegos nuevos hasta cerrarla.
- **Un fallo en directo delante de la clase** → pruebas automáticas + ensayo en el proyecto de
  pruebas con varios móviles antes de estrenar cada modo.
- **Trampas en juegos con puntos** → corrección y tiempos en el servidor, nunca en el móvil.
- **Supabase cambia sus límites o su precio** → todo el acceso pasa por `api.js` y por
  funciones SQL estándar de Postgres: migrar sería trabajo, no reescribir.
