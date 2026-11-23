# Primer directo en clase (TDA I) — guía

Primera vez que el modo **directo** (tipo Kahoot) se usa con alumnos de verdad. Ellos, desde los **ordenadores del aula**; tú, desde el **móvil**.
Es en **producción**: los alumnos usan su código de siempre (`TDA1-nn`) y en pantalla solo se ven **apodos** («Zorro Azul»).

## 0. Antes de la clase (hoy, desde el ordenador) — 4 cosas, en este orden

| # | Qué | Dónde | Qué debe salir |
|---|---|---|---|
| 1 | Instalar el directo en la base REAL: pega `supabase/09_directo.sql` entero | Supabase (proyecto real, el que pone **PRODUCTION**) → SQL Editor → New query → Run | `tablas_nuevas = 3`, `funciones_profe_directo = 6`, `funciones_alumno_directo = 3` |
| 2 | Comprobar que quedó cerrado: pega `supabase/verificar_fase2.sql` entero | igual | **una fila con 6 columnas, todas `true`** |
| 3 | Publicar la web (fusionar `fase-2` en `main` y subir) | lo hace Claude cuando des tu sí | `directo.html` y `jugar.html?d` responden |
| 4 | Subir el banco de preguntas | Panel real (`panel.html`) → Inicio → Exámenes → **⚙ Gestionar exámenes** → **⬆ Subir banco (.json)** → elige `tests/tda1-u1u2-repaso.json` (está en la carpeta del proyecto) | Te pide confirmar («¿Subir … con 40 preguntas?»); luego: «Banco «tda1-u1u2-repaso» subido: 40 preguntas (versión 1).» |

> El banco del repaso de TDA I ya es público (es el test de práctica), así que no hay nada secreto en él. Los bancos de EXÁMENES de verdad nunca van al repo.

## 1. Cinco minutos antes de empezar (en el móvil)

1. Abre `https://moliw4n.github.io/Plataforma_Tests/directo.html` e **inicia sesión** con tu cuenta (si ya entraste en el panel desde ese móvil, ya estás dentro).
2. **Nueva sala**: Grupo **TDA1** · Banco **Repaso U1 y U2** · Preguntas **10** · Segundos **20** · Título «Repaso U1-U2» · deja marcado «Repartir por temas».
3. Pulsa **Abrir sala**. Sale el **código de 6 cifras** y el enlace.
4. La pantalla del móvil **no se apagará** mientras lleves la sala (si el navegador lo permite). Aun así, pon el móvil en carga.
5. Si tienes proyector y quieres proyectar: abre `directo.html` en el ordenador del profesor, entra con tu cuenta y pulsa **Abrir** en «Salas abiertas». Puedes llevar los botones desde el móvil **o** desde ese ordenador (los dos ven lo mismo).

## 2. En clase

**Lo que dices a los alumnos:** «Abrid `moliw4n.github.io/Plataforma_Tests/jugar.html?d` (o el favorito que os paso), escribid vuestro código y, cuando os lo pida, el número de la sala: **XXX XXX**».
Es un enlace fijo: pueden guardarlo en favoritos para otro día; lo único que cambia es el número de sala. El enlace con el número dentro también vale: `…/jugar.html?d=XXXXXX`.

1. Verás los **apodos** aparecer en tu pantalla (los desconectados salen atenuados). Espera a que estén todos.
2. Pulsa **Empezar ▶**. Cada alumno ve la pregunta en **su ordenador** (no hace falta proyectarla).
3. Mira «**X de N han contestado**». Cuando contesten casi todos, o se acabe el tiempo, **Cerrar la pregunta ■** (si se acaba el tiempo, se cierra sola).
4. Sale el **resultado**: la correcta, cuántos eligieron cada opción, el «por qué» y la «trampa», y el top 5. Aprovecha para explicarla.
5. **Siguiente pregunta ▶**, y así hasta **Ver el final ▶** (el podio).
6. «**Ver quién es quién**» enseña el número de alumno junto a cada apodo (solo tú, no lo hagas con el proyector delante si no quieres).

Cada alumno ve en su ordenador: si acertó, sus puntos (de 1000 a 500 según lo rápido que conteste), su posición y el top 5.

## 3. Qué anotar (para mejorarlo)

- ¿Se entiende cómo entrar? ¿Alguien se pierde en algún paso? (apunta dónde)
- ¿Entran todos a la primera? ¿Alguno no puede (código, grupo…)?
- ¿Los **20 s** son pocos o muchos para este tipo de preguntas?
- ¿Se ve bien en los ordenadores del aula (tamaño, zoom, navegador)? ¿Y desde el móvil, para ti?
- ¿Se nota lag? (si un alumno ve la pregunta mucho más tarde que otro)
- ¿Los puntos y el marcador motivan, o hay algo raro?
- Lo que se te ocurra que falta.

## 4. Si algo falla

| Pasa esto | Haz esto |
|---|---|
| Un alumno: «Ese código no existe» | Revisa que no haya ceros en vez de letras O. Es su código de siempre (`ABC-123`). |
| Un alumno: «Esa sala no existe, ya ha terminado o no es para tu grupo» | Está mal el número de sala, o la sala es de otro grupo (la tuya es **TDA1**). |
| Un alumno se queda en blanco o se le cuelga | Que **recargue** la página y vuelva a entrar con su código y la sala: conserva apodo y puntos. |
| «Demasiados intentos seguidos» | Hubo muchos códigos mal escritos a la vez. Esperar **1 minuto**. |
| Se cae internet en el aula | Los ordenadores avisan en rojo y siguen solos al volver. No hace falta tocar nada. |
| Se te apaga el móvil / pierdes la pantalla | Vuelve a abrir `directo.html`: te lleva a la sala que estaba abierta. |
| La sala va rara o quieres empezar de cero | **Cerrar sala** y abre otra (cambia el número; los alumnos escriben el nuevo). |
| Todo falla | **Plan B**: práctica normal `…/jugar.html?t=tda1-u1u2-repaso` (como siempre). |

## 5. Después

- Las salas no se borran; una sala olvidada se cierra sola (pasadas 12 horas) cuando abres otra. Los resultados (puntos y aciertos por alumno) quedan guardados en el servidor; verlos en el panel es el paso siguiente del desarrollo (aún no está).
- Cuéntale a Claude qué anotaste en el punto 3 y se ajusta antes de la siguiente clase.
