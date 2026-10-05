# Fichas de agentes

Regla del usuario (05-10-2026): **cada agente tiene su ficha**, y su paso del roadmap no se cierra sin ella.
Una ficha por agente: `docs/fork/agents/<agente>.md`.

## Plantilla
1. **Estructura** — archivos (`S/…:línea`), prompt (resumen y secciones), herramientas permitidas y prohibidas,
   permisos, modelo por defecto y configuración.
2. **Funcionamiento** — flujo de trabajo paso a paso, reglas obligadas por código (no solo por prompt), límites y
   qué hace cuando algo falla.
3. **Pruebas y resultados (evidencia)** — para cada prueba: tipo (unitaria, QA aislada, banco), suite, modelo, fecha,
   cifras (acierto, fallos, citas, tokens, tiempo, contexto por petición) y la ruta a los datos crudos
   (`.omo/evals/…`, `.omo/evidence/…`). Las tareas difíciles se reportan aparte; las comparaciones con la versión
   anterior o con otro agente, en una tabla.
4. **Decisiones y descartes** — qué se eligió, qué se descartó y por qué, con fecha.
5. **Siguiente medición** — qué falta medir para confiar más (nunca una tarea pendiente del paso).
