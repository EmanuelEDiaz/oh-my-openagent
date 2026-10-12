# 0.23 — Modo de ideas en el planificador

**Estado:** plan aprobado el 11-10-2026, en tres capas y midiendo primero.
- **Capa 1 (puerta por código) y comando `/omo-ideas`:** implementados, con pruebas (ver abajo).
- **Medición de referencia, capa 2 y QA en la interfaz real:** pendientes, bloqueadas por RAM.

## Problema (usuario, 10-10-2026)

> "… el modo planificación … ordenar sus ideas chateando con la IA y mandando a investigar para, si así lo quiere,
> agregarlo al plan"

Hoy Prometheus convierte enseguida cualquier conversación en un plan. Al usuario le falta un espacio donde charlar
ideas sin compromiso, mandarlas a investigar y decidir después cuáles entran en el plan.

## Sistemas homólogos (investigado 11-10-2026)

| Sistema | Qué hace | Qué tomamos |
| --- | --- | --- |
| Replit Plan Mode | Charlar y planificar sin tocar código; después se pasa a Build ([docs](https://docs.replit.com/learn/plan-vs-build-mode)) | Las ideas no tienen efectos secundarios. |
| PlayCode / Snowflake Cortex / Unity Assistant | Separan Ask (solo lectura) de Plan (preguntas de aclaración y luego plan) ([PlayCode](https://playcode.io/help/agent-modes)) | Explorar es un estado distinto de planificar. |
| BMAD, analista "Mary" | Brainstorming con técnicas (5 porqués, "¿y si…?", SCAMPER) que termina en un project brief opcional ([BMAD](https://docs.bmad-method.org/vi-vn/tutorials/getting-started/)) | Técnicas para ampliar y bajar a la necesidad real. |
| obra/superpowers, skill `brainstorming` | Una pregunta por mensaje, con opciones; propone enfoques y recomienda uno; nada se implementa sin aprobación (hard gate) ([guía](https://mcp.directory/blog/claude-brainstorming-skill-guide)) | Ritmo de una pregunta cada vez, y puerta antes de pasar al plan. |
| Ninguno de los anteriores | Ninguno tiene una lista de ideas que sobreviva a la sesión | `.omo/ideas.md` es lo nuevo. |

### ¿Un modelo pequeño que orqueste? (pregunta del usuario, 11-10-2026)

- **A favor:**
  - Los modelos pequeños rinden en tareas acotadas y repetitivas
    ([NVIDIA, "SLMs are the future of agentic AI"](https://arxiv.org/abs/2506.02153v1)).
  - Arch-Router (1,5B) enruta peticiones mejor que modelos grandes ([arXiv 2506.16655](https://arxiv.org/abs/2506.16655v1)).
  - Nemotron-Orchestrator-8B orquesta y supera a GPT-5 en HLE con alrededor del 30 % del coste
    ([ToolOrchestra](https://research.nvidia.com/labs/lpr/ToolOrchestra)).
- **En contra:**
  - Esos modelos están entrenados para enrutar u orquestar; los gratuitos de Zen no lo están.
  - Un modelo local no cabe: 7,6 GB de RAM, y el usuario pidió no lanzar ollama.
  - Las reglas que importan ya las aplica el código, sin modelo y sin tokens.
- **Decisión:** tres capas, y medir antes de construir la capa del modelo pequeño.

## Diseño

```mermaid
flowchart TD
    U[Usuario en Prometheus: /omo-ideas o 'idea: …'] --> K{Capa 2: modelo pequeño gratuito<br/>clasifica el mensaje}
    K -- idea nueva / charla --> G[Capa 3: modelo grande<br/>una pregunta cada vez, critica la idea]
    K -- investigar --> W["@web-researcher / explore<br/>(grupo de Prometheus, 0.22)"]
    W --> S[Capa 2: resume el resultado con fuentes]
    S --> F[".omo/ideas.md<br/>estado: cruda → investigada"]
    G --> F
    K -- 'añádelo al plan' --> P{Capa 1: código<br/>¿orden explícita del usuario?}
    P -- sí --> PL[Prometheus escribe en .omo/plans/<br/>idea → 'al plan']
    P -- no / ambigua --> Q[Pregunta de confirmación al usuario]
```

1. **Capa 1, código.** Mientras el modo de ideas está activo, cualquier escritura en `.omo/plans/` se bloquea si no
   hay una orden explícita del usuario. La puerta mira el texto del usuario, no lo que decida un modelo; una orden
   ambigua lleva a una pregunta de confirmación. `.omo/ideas.md` sí se puede escribir.
2. **Capa 2, modelo pequeño gratuito** (el `small_model` del plugin):
   - clasificar cada mensaje;
   - mantener `.omo/ideas.md` resumido y sin duplicados;
   - resumir lo que traigan los investigadores antes de que lo lea el modelo grande.
3. **Capa 3, modelo grande** (el de Prometheus): conversar y criticar, con lo bueno, lo malo y el porqué, una pregunta
   por mensaje y con opciones cuando se pueda.

Formato de `.omo/ideas.md`: una entrada por idea, con título, fecha, estado (`cruda`, `investigada`, `al plan` o
`descartada`), resumen, fuentes y un enlace al plan cuando entra en él. Así se puede retomar en otra sesión, en
conexión con 0.17b.

## Medir primero

Primero, la referencia: Prometheus de hoy con el modelo grande solo. Después se comparan las variantes, con las mismas
tareas en el banco:

| Caso | Tipo | Qué se mide |
| --- | --- | --- |
| Idea vaga ("quiero que el agente sea más listo") | simple | Que pregunte una cosa cada vez y no escriba un plan. |
| "Investiga si X ya existe" | difícil | Que delegue en `@web-researcher` y guarde la respuesta con fuentes. |
| "Sí, añádelo" tras dos ideas | extremo, ambiguo | Que pregunte cuál de las dos. |
| Idea mezclada con una orden de implementar | extremo | Que no implemente y lo trate como idea. |
| Intentar colar la idea en el plan sin orden | extremo | La puerta de código bloquea. |
| Retomar en otra sesión | difícil | Que la lea de `.omo/ideas.md`. |

Métricas:
- tokens del modelo grande por conversación;
- aciertos del modelo pequeño al clasificar (los casos ambiguos, aparte);
- escrituras indebidas en el plan (deben ser 0);
- tiempo.

La capa 2 se queda solo si reduce los tokens del modelo grande sin bajar los aciertos ni las respuestas correctas.

## Capa 1 implementada (11-10-2026)

- `features/ideas-mode/gate.ts`:
  - el modo se calcula a partir de los mensajes del usuario: `/omo-ideas` (o un mensaje que empieza por `idea:`) lo
    enciende y `/omo-ideas off` lo apaga;
  - la orden explícita es un verbo como añadir, agregar, meter, incluir, pasar o poner (o add, put, move, include)
    seguido de "al plan", "en el plan", "to the plan" o "in the plan";
  - no cuentan como orden las preguntas, las negaciones previas ("no lo añadas al plan") ni un simple "sí" u "ok".
- `features/ideas-mode/session-user-texts.ts`: lee los mensajes del usuario de la sesión, sin las partes sintéticas.
  Así ningún texto inyectado puede abrir la puerta, y la puerta sobrevive a un reinicio. Si los mensajes no se pueden
  leer, el planificador funciona como antes.
- `hooks/prometheus-md-only/hook.ts`: antes de escribir en `.omo/plans/`, aplica `planWriteRefusal`. En modo de ideas
  rechaza la escritura sin la orden y explica qué hacer: guardarla en `.omo/ideas.md` y preguntar al usuario.
- `/omo-ideas` (`features/builtin-commands/commands.ts`): se ejecuta con Prometheus y su instrucción es corta
  (regla 16).

| Prueba | Casos | Antes del cambio |
| --- | --- | --- |
| `features/ideas-mode/gate.test.ts` | 24: encendido y apagado; 8 órdenes válidas en español e inglés; 8 que no lo son (sí, ok, negaciones, preguntas); una orden antigua no cubre turnos nuevos; una nota sintética no abre la puerta | módulo inexistente |
| `hooks/prometheus-md-only/ideas-mode.test.ts` | 4: rechazo sin orden, permiso con orden, `.omo/ideas.md` siempre escribible, comportamiento anterior fuera del modo o sin mensajes | 1 falla |
| `features/builtin-commands/ideas-command.test.ts` | 2: el comando se ejecuta con Prometheus, enciende y apaga el modo, y la instrucción mide menos de 1.500 caracteres | 1 falla |
| Regresión | `prometheus-md-only` 49/49, comandos y esquemas 7/7 | — |

## Orden de trabajo

1. Escenarios del banco y medición de la referencia.
2. Capa 1 (la puerta del plan), con pruebas que fallen antes del cambio.
3. Capa 3: el skill o prompt corto del modo de ideas (regla 16) y `.omo/ideas.md`.
4. Capa 2 y su medición frente a la referencia.
5. QA en la interfaz real (regla 17): `/omo-ideas`, una investigación y "añádelo al plan".
6. Documentar el cierre, actualizar la fila 0.23 del roadmap, fusionar, reconstruir y subir.
