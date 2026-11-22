# Ensayo del modo examen (proyecto de PRUEBAS + varios móviles)

> Antes de publicar los exámenes para los alumnos, se ensayan con datos inventados, en un proyecto de Supabase **aparte**, y con móviles de verdad.
> Nada de esto toca los datos de los alumnos: el proyecto de pruebas es otro, y el código se niega a mezclarlos.

## 1. Crear el proyecto de pruebas (una vez, 5 minutos)
1. https://supabase.com/dashboard → **New project** (el plan gratuito deja tener dos).
2. Nombre `kiron-pruebas` · región de la **UE** (como el real) · una contraseña de base de datos (guárdala en tu gestor; **no la necesito**).
3. Espera un par de minutos a que diga «Project is ready».

## 2. Instalar las tablas y funciones (un solo archivo)
1. En VS Code abre **`supabase/paquete_pruebas.sql`** → `Cmd+A` → `Cmd+C`.
2. En Supabase (el proyecto de **pruebas**) → **SQL Editor** → **New query** → pega todo → **Run**.
   - Si pregunta «Run this query? (potentially destructive)», acepta: el archivo empieza borrando restos de una versión antigua que aquí no existen.
3. Debe salir **una fila** exactamente así:

   | tablas | tablas_sin_rls | alumnos_de_prueba | funciones_alumno | funciones_profe |
   |---|---|---|---|---|
   | 13 | 0 | 5 | 9 | 12 |

   Si sale otra cosa, no sigas: dime qué sale.
4. Es seguro repetirlo. Y se niega a ejecutarse en una base con alumnos reales (aborta sin tocar nada).

## 3. Tu usuario de profesor en el proyecto de pruebas
1. **Authentication → Users → Add user → Create new user**: tu correo y una contraseña de **pruebas** (distinta de la de verdad), con «Auto Confirm User» marcado.
2. En el SQL Editor (cambia el correo por el tuyo):
   ```sql
   insert into public.profesores(email) values ('TU-CORREO@ejemplo.com');
   ```
   Debe salir `Success. No rows returned`.

## 4. Pásame la URL y la clave pública
En **Project Settings → API** (o «API Keys»): copia
- **Project URL**: `https://xxxxxxxx.supabase.co`
- **Publishable key**: `sb_publishable_…`

Son públicas por diseño (como las del proyecto real). **Nunca** la `secret` ni `service_role`: si la ves, no la copies.
Con eso las pongo yo en `js/config.js` (entorno `pruebas`).

## 5. Arrancar el servidor para los móviles
En una Terminal, en la carpeta del proyecto:
```bash
npm run ensayo:servidor
```
Enseña la dirección de tu ordenador en la WiFi, por ejemplo `http://192.168.1.34:4173`. Los móviles tienen que estar **en la misma WiFi**.
- **Panel (en el ordenador):** `http://localhost:4173/panel.html?entorno=pruebas`
- **Examen (en los móviles):** `http://192.168.1.34:4173/jugar.html?j=ensayo&entorno=pruebas` (cambia la IP por la tuya).
- Verás una franjita amarilla **«PRUEBAS · datos de ensayo»** abajo: así sabes que no estás en el real. Si NO la ves, no estás en pruebas: para.

## 6. Montar el examen de ensayo (en el panel)
1. Entra con tu usuario del paso 3 → **⚙ Gestionar exámenes**.
2. **Subir banco** → `docs/ensayo/banco-ensayo.json` (20 preguntas inventadas de informática: 4 tipos, 4 temas) → Subir.
3. **Crear un examen** — dos:
   | id | título | banco | preguntas | minutos | fallo |
   |---|---|---|---|---|---|
   | `ensayo` | Ensayo | el de ensayo | 12 | 15 | No resta |
   | `ensayo-corto` | Ensayo corto | el de ensayo | 5 | 1 | No resta |
4. **Ponerlo a un grupo**: cada examen al **Grupo de pruebas**; en `ensayo` pon **2 intentos** y marca «Enseñar la revisión…».
5. Los alumnos de prueba tienen estos códigos (inventados, sin nada personal):

   | Alumno | Código |
   |---|---|
   | PRUEBA-01 | `AAA-222` |
   | PRUEBA-02 | `BBB-333` |
   | PRUEBA-03 | `CCC-444` |
   | PRUEBA-04 | `DDD-555` |
   | PRUEBA-05 | `EEE-666` |

## 7. Ensayo automático (puedo hacerlo yo, o tú)
**Antes de nada, la comprobación rápida** (no necesita ningún examen; 10 segundos):
```bash
npm run ensayo:simular -- base --url https://TU-PROYECTO.supabase.co --key sb_publishable_…
```
Comprueba que los 5 alumnos de prueba entran con su código, que uno inventado se rechaza, que el latido y las funciones del examen responden y que
desde fuera (con la clave pública) no se puede leer ni escribir ninguna tabla ni llamar a las funciones del profesor. Se puede repetir las veces que quieras.

**Luego, el ensayo completo con los 5 alumnos a la vez:**
Simula 5 alumnos a la vez contra el servidor **de verdad** y comprueba, entre otras cosas: que no llega ninguna solución, que la nota no se ve antes de publicarla, que desde fuera no se puede leer ninguna tabla y que las notas salen como deben.
```bash
npm run ensayo:simular -- jugar --url https://TU-PROYECTO.supabase.co --key sb_publishable_… --juego ensayo --banco docs/ensayo/banco-ensayo.json
```
Después, en el panel: **Ver resultados** del examen `ensayo` → mira alumnos, salidas de pestaña y notas → **Publicar las notas**. Y:
```bash
npm run ensayo:simular -- comprobar --url https://TU-PROYECTO.supabase.co --key sb_publishable_…
```
Se niega a funcionar con la URL del proyecto real o con cualquier dirección que no sea `localhost` o `*.supabase.co`. (Para repetirlo, anula las partidas en el panel o crea otro examen.)

## 8. Ensayo con móviles (lo que no se puede automatizar)
Lo ideal: **un iPhone (Safari) y un Android (Chrome)**, y si puedes uno más. Cada uno con un código distinto. Examen `ensayo`, salvo donde se indica.

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 1 | Abrir el enlace, escribir el código, **Empezar** | Se ve la portada con las reglas y «Empezar el examen». Se ve la franja de PRUEBAS. |
| 2 | Contestar los 4 tipos (opciones, V/F, número con **coma** decimal, texto) | Teclado numérico en las numéricas. Nada se pone verde ni rojo. Se puede cambiar de respuesta. |
| 3 | **Cambiar de app** 10 s (o ir a Inicio) y volver | Aviso «Has salido de la página…». En el panel: 1 salida con ~10 s fuera. |
| 4 | **Bloquear la pantalla** 20 s y volver | Sigue donde estaba, con el reloj bien. Cuenta como salida. |
| 5 | **Modo avión** 30 s mientras contestas; luego desactívalo | Aviso rojo «Sin conexión…». La respuesta sigue marcada. Al volver el aviso desaparece y la respuesta llega (míralo en el panel). |
| 6 | Con el modo avión puesto, intentar **entregar** | No entrega: dice cuántas respuestas no se han guardado y deja el examen abierto. |
| 7 | **Recargar** la página a mitad y volver a entrar con el código | «Continuar el examen», con lo contestado y el reloj sin reiniciarse. |
| 8 | **Cerrar la pestaña** del todo y volver a abrir el enlace | Igual que el 7. |
| 9 | **Girar** el móvil | No se rompe nada; sin desborde horizontal. |
| 10 | El mismo código en **dos móviles** a la vez | Los dos entran en LA MISMA partida (la última respuesta que se envíe es la que vale). Anota qué te parece. |
| 11 | **Entregar**: Revisar y entregar → confirmar | «✓ Entregado» sin nota. «Comprobar si ya hay nota» → «Todavía no está publicada». |
| 12 | Volver a entrar tras entregar (`ensayo` tiene 2 intentos) | Te deja empezar el 2.º; con 1 intento diría «Ya has entregado». |
| 13 | Examen **`ensayo-corto`** (1 minuto): empezar y esperar sin tocar | A los 60 s se entrega solo: «SE ACABÓ EL TIEMPO». El reloj se pone ámbar y rojo antes. |
| 14 | Publicar las notas en el panel y mirar el móvil | «Comprobar si ya hay nota» → su nota y, con la revisión permitida, cada pregunta con su «por qué». |
| 15 | En el panel: abrir un alumno | Mapa de preguntas, salidas de pestaña, recargas. «Anular intento» (pruébalo con una). |

**Qué apuntar si algo falla:** modelo del móvil, navegador, en qué paso, y qué pasó en vez de lo esperado (una captura ayuda mucho). Si se queda a medias, el estado se ve en el panel.

## 9. Después
Si todo va bien, el paso 8 de la fase 1 es publicarlo: ejecutar `06`, `07` y `08` en el proyecto **real** (con tu visto bueno) y fusionar. Hasta entonces los alumnos no ven nada de esto.
