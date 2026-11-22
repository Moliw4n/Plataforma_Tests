# Kiron · formato del contenido y resultados de exámenes (para Kronos)

> Escrito durante la fase 1 (nov 2026). Lo que cambia respecto a `~/Development/Kronos-aula/docs/plataforma-tests.md`.

## 1. `tests/<id>.json` ahora está en FORMATO 2

Los archivos de `tests/` (las prácticas públicas) pasaron de formato 1 a formato 2. `tests/index.json` **no cambia** (`[{id, grupo, titulo, tipo}]`).

| | formato 1 (antes) | formato 2 (ahora, `"formato": 2`) |
|---|---|---|
| test | `tipos: {id: {nombre, color}}` | `categorias: {id: {nombre, color}}` |
| pregunta | `tipo: 'imprime'` (la etiqueta de color) | `tipo: 'opcion_multiple'` (el TIPO de pregunta) y `categoria: 'imprime'` (la etiqueta de color) |
| resto | `id, act, tema, enun, code?, ops, ok, sol, trampa, salida?, stdin?, fija_ultima?…` | igual (+ opcionales `dificultad` 1-3, `criterio`, `etiquetas`) |

**Si Kronos lee `tests/<id>.json`** (fase 3 de su plan: portar `estadisticasPreguntas`, `abrirDetalle`…): la etiqueta de color de una pregunta es ahora `categoria`, no `tipo`; y las etiquetas con nombre y color están en `categorias`. Para aceptar los dos formatos, copia `aFormato2()` de `js/nucleo/formato.js` (es una función pura de 12 líneas, idempotente).

Tipos de pregunta que se juegan: `opcion_multiple` (`ops`, `ok`), `verdadero_falso` (`ok: true|false`), `numerica` (`valor`, `tolerancia?`, `unidad?`), `respuesta_corta` (`aceptadas[]`, `pista?`).

## 2. Lo guardado en `intentos` (prácticas) — igual que siempre
`respuestas: [{id, elegida, ok, ms}]` para opción múltiple. Los tipos nuevos guardan `dada` en vez de `elegida`: `{id, dada, ok, ms}` (`dada` = true/false o el texto escrito).

## 3. Exámenes: se leen con `profe_resultados(asignacion)`

Los exámenes no usan `intentos`: usan `partidas`, `respuestas` y `eventos` (supabase `06`, `07`, `08`). Lo que lee Kronos es la función del profesor (con sesión iniciada, como `profe_alta_alumnos`):

`rpc/profe_resultados` con `{ "p_asignacion": <id> }` → devuelve, una fila por partida, el **resultado normalizado** del plan (5.3):

```json
{ "ok": true,
  "asignacion": { "id", "juego", "titulo", "grupo", "desde", "hasta", "intentos", "mostrar_soluciones", "notas_publicadas" },
  "partidas": [{
    "partida": "uuid", "alumno": "TDA2-07", "juego": "ex1", "intento": 1, "estado": "entregada|en_curso|caducada",
    "empezada": "…", "terminada": "…|null", "segundos": 1500, "total": 20, "aciertos": 15, "nota": 7.5, "puntos": 0,
    "por_criterio": { "2.1": 0.8, "2.2": 0.5 },
    "eventos": { "salidas": 2, "vueltas": 2, "recargas": 0, "sin_red": 0, "segundos_fuera": 42 },
    "respuestas": [{ "id": "banco/q01", "respondida": true, "ok": true, "dada": 1, "ms": 5200 }]
  }] }
```
- `nota` 0-10 (sin redondear a más de 2 decimales). **Lo no contestado cuenta como fallo.** `null` mientras la partida está `en_curso`.
- `por_criterio`: fracción de aciertos (0-1) en las preguntas que llevan `criterio`; es el puente con la nota por criterios de Kronos.
- Para importar como **«Examen por preguntas»** (plan de Kronos, fase 2): una pregunta de Kronos por pregunta del examen, con `respuestas[].ok` y `respondida` (blanco = 0, acierto = max, fallo = penalización).
- Estadísticas por pregunta: `rpc/profe_estadisticas_examen` con `{ "p_asignacion": <id> }`.
- Las notas están ocultas a los alumnos hasta `rpc/profe_publicar_notas` `{ "p_asignacion", "p_publicar": true }`; el profesor SIEMPRE las ve.
- Si un alumno tuvo un problema técnico: `rpc/profe_borrar_partida` `{ "p_id": "<uuid>" }` borra esa partida y libera el intento.

Los bancos de examen (con soluciones) **no están en el repositorio**: se suben desde el panel (`panel.html` → Gestionar exámenes) y viven solo en Supabase.
