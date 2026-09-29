# Roadmap del fork — agentes especializados, fundamentados y citables

Estado: **vivo**. Se actualiza al cerrar cada paso. Rutas: `S/` = `packages/omo-opencode/src/`.

## Misión
Un plugin que **cubra los huecos que OpenCode deja a los modelos de código abierto**: que un modelo gratuito o local
trabaje con la fiabilidad de uno de pago porque el plugin le da contexto justo, especialistas, reglas en el momento
adecuado y comprobaciones por código. Criterio para cada paso: **solo entra lo que es la mejor opción conocida**; si el
plugin ya tiene algo mejor o la investigación encuentra algo mejor, lo otro se descarta y se anota por qué.

## Objetivo
Una sola estructura que se quede con **lo mejor** de oh-my-openagent y de tu biblioteca/agentes, donde:
1. Un orquestador descompone cada tarea en **tareas atómicas** y las envía al **especialista** adecuado.
2. Cada especialista está optimizado para su tipo de tarea y usa **obligatoriamente** las herramientas que esa
   tarea exige (p. ej. investigar en la web antes de usar una librería externa).
3. **Nada importante se pierde al compactar el contexto:** peticiones literales, restricciones, decisiones y
   trabajo pendiente sobreviven a la compactación, y lo resumido conserva un puntero a su origen.
4. Todo lo que se afirma es **citable y verificable**: archivo:línea, commit, URL o puntero de chat
   (`ses_… → msg_… → prt_…`), con un índice eficiente que controla su crecimiento y se poda.
5. Se avanza **paso a paso**: cada paso tiene análisis, plan detallado aprobado, implementación, QA real y merge.

## Principios (con fuente)
- **Orquestador–trabajadores:** el orquestador divide y delega; cada subagente tiene su propio contexto y
  devuelve **un resumen con fuentes**, no su transcript. —
  [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- **Delegar bien:** a cada subagente se le da *objetivo, formato de salida, guía de herramientas/fuentes y
  límites claros*; el esfuerzo escala con la complejidad (1 agente y 3–10 llamadas para un dato puntual,
  2–4 subagentes para comparaciones). Herramientas con propósito distinto y descripción clara; las malas
  descripciones mandan al agente "por caminos completamente equivocados". Búsqueda: *consultas cortas y
  amplias, luego estrechar*. Citas con un paso dedicado. —
  [Anthropic, multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- **Fundamentar antes de afirmar:** obligar a recuperar y citar datos antes de responder reduce
  alucinaciones; en código, inspeccionar el código/documentación real antes de afirmar sobre él. —
  [Claude docs, reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
- **Índice que no se degrada:** FTS5 fusiona segmentos automáticamente; `optimize` + `VACUUM` periódicos
  compactan índice y archivo. — [SQLite FTS5](https://www.sqlite.org/fts5.html)
- **Tu biblioteca:** criterios Gherkin antes de implementar, marcar solo con evidencia, decisions log con
  *Evidence session*, retención en 3 capas (resume / cold / orphan). — `ai-guidelines/documentation/planning-log.md`

## Estado actual (hechos verificados en el código)
- **El enrutamiento es solo texto en el prompt.** Ningún código obliga a elegir un especialista ni a
  delegar (`S/tools/delegate-task/subagent-request-preflight.ts` solo rechaza 3 casos). Las correcciones al
  orquestador que usa herramientas directamente son **avisos**, no bloqueos
  (`S/hooks/agent-usage-reminder/`, `S/hooks/atlas/tool-execute-before.ts:121`).
- **Nada obliga a investigar antes de responder**, y nadie comprueba que el librarian cite fuentes
  (su regla "MANDATORY CITATION FORMAT" está solo en el prompt, `S/agents/librarian.ts:208`).
- **Tus agentes personalizados se pueden llamar pero el orquestador no sabe que existen**:
  `_customAgentSummaries` no se usa (`S/agents/builtin-agents.ts:69`) y un test lo exige así.
- **Las categorías no pueden exigir skills** (`CategoryConfigSchema` no tiene `skills`).
- **Faltan especialistas:** verificador/QA de tests, revisor de seguridad, investigador solo de
  documentación oficial (el librarian mezcla docs y código de repos ajenos). Tus 4 revisores cubren parte.
- **Sin memoria/índice entre sesiones en OpenCode** y búsqueda de sesiones por subcadena sin ranking.
- **Compactación con pérdida posible:** el resumen lo escribe el propio modelo con una plantilla de 8
  secciones (`S/hooks/compaction-context-injector/compaction-context-prompt.ts`), disparada al 78 % del
  contexto (`S/hooks/preemptive-compaction-trigger.ts:15`). La plantilla pide citar al usuario "solo cuando
  haga falta" (las peticiones pueden quedar parafraseadas), no guarda punteros a los mensajes originales y
  **nadie verifica** que el resumen conserve lo crítico. Solo los todos y el estado del agente se preservan de
  forma mecánica (`S/plugin/session-compacting.ts`, `S/hooks/compaction-todo-preserver/`).
- **Bug de pérdida de datos** en worktrees del modo team (`rm -rf` sobre rutas no creadas por omo).
- Varios `AGENTS.md` internos están desactualizados (p. ej. dicen que Atlas no puede usar `task`).

## Cómo se trabaja cada paso
`análisis → plan detallado en docs/fork/plans/<paso>.md (criterios Gherkin) → tu aprobación →
rama propia → test RED → implementación → tests → QA real en OpenCode aislado → evidencia local →
merge --no-ff a mis-mejoras → actualizar este roadmap`.

---

## Notas de QA (para no repetir errores)
- Un sandbox de OpenCode recién creado instala `@opencode-ai/plugin` desde npm en su carpeta de configuración y puede
  quedarse colgado (ignora SIGTERM). Copiar antes `node_modules/`, `package.json` y `package-lock.json` desde
  `~/.config/opencode` y lanzar con `timeout -s KILL`.
- Nunca usar `pkill -f` con un patrón que aparezca en el propio comando.
- Borrar el sandbox al terminar: contiene una copia de `auth.json`.
- Los ajustes del plugin en `.omo/omo.jsonc` van dentro de `"[opencode]": { … }`; una clave como `knowledge` en la raíz se
  descarta (`Unrecognized key`) y el plugin usa los valores por defecto sin fallar. Comprobar en `/tmp/oh-my-opencode.log`
  que el ajuste se aplicó antes de fiarse de una medición.
- El tier gratuito de OpenCode Zen rechaza (403) peticiones sin ninguna herramienta, y a veces un turno se queda colgado sin
  error: poner tiempo límite por turno y abortar la sesión.
- Un `opencode run` que termina con normalidad borra los equipos que creó; para probar equipos colgados hay que matar el
  proceso (`setsid` + `kill -9 -<pgid>` una vez escrito `state.json`).
- A veces `opencode run` se queda parado al arrancar, antes de crear la sesión (sin log del plugin): reintentar una vez.
- Muchas ejecuciones seguidas agotan los modelos gratuitos ("Insufficient account funds", "Rate limit exceeded"): activar
  `runtime_fallback` con una cadena de varios modelos en el sandbox y espaciar las pruebas.

## Fase 0 — Seguridad
| Paso | Qué | Estado | Plan |
|---|---|---|---|
| 0.1 | Worktrees seguros: no borrar nunca rutas que omo no creó; worktrees reales con git; no borrar trabajo sin guardar. | **hecho** (27-09-2026, rama `fix/team-worktree-safety`) | `plans/knowledge-base-and-worktrees.md` (Pieza 4) |
| 0.2 | Borrar equipos desde otra ejecución: `team_delete` exige la sesión líder pero ese registro vive en memoria y se pierde entre procesos (`opencode run`), dejando equipos y worktrees huérfanos. Hallado en la QA de 0.1. | **hecho** (29-09-2026): mensaje con la sesión líder y cómo seguir; CLI `team list` / `team delete [--force] [--dry-run]`; cualquier sesión puede forzar el borrado de equipos huérfanos o atascados. `plans/team-delete-cross-process.md` |

## Fase 1 — Fundamento: índice, citas de chat y decisiones
| Paso | Qué | Estado |
|---|---|---|
| 1.1 | **Diseño del índice y su ciclo de vida** (solo análisis + plan): qué se indexa, formato de locator, presupuesto de tamaño, poda (capas resume/cold/orphan de tu biblioteca), `optimize`/`VACUUM`, qué pasa al borrar sesiones, rendimiento medido. | **análisis hecho**, plan en revisión: `plans/knowledge-index.md` |
| 1.2 | Índice del proyecto (`.omo/cache/knowledge.db`, FTS5 + BM25) + herramienta `knowledge_search` con locators citables. | **hecho** (28-09-2026) |
| 1.3 | **Citas de chat:** indexado de sesiones leyendo `opencode.db` en solo lectura (tu método validado), puntero `ses_… → msg_… → prt_…`, comando de re-auditoría, poda de sesiones borradas y "una sesión vive si algo la referencia". + `knowledge_open` y `knowledge report [--vacuum]`. | **hecho** (28-09-2026) |
| 1.3b | Que el `session_search` antiguo (subcadena, sin ranking) use el índice o remita a `knowledge_search`: en la QA el agente lo probó primero y no encontró nada. | **hecho** (28-09-2026) |
| 1.4 | Decisiones citadas en tu formato (`docs/decisions/` + Decisions log del plan activo). | **hecho** (28-09-2026): `decision_record`/`decision_search`, verificador de citas, bloque `<grounding>` en los prompts, Atlas relee `decisions.md` |
| 1.4b | **Decisiones que escalan:** el plan guarda enlaces (bloque generado entre marcadores) en vez de copias; vista `knowledge decisions`; campo `area`; validación del esquema; carpetas por año al superar ~200. Análisis y fuentes en `plans/decisions-scaling.md`. | **hecho** (28-09-2026) |
| 1.4c | **Las decisiones encuentran al agente:** al leer/editar un archivo citado por una decisión activa, se inyecta una línea con esa decisión (una vez por sesión, con aviso si la evidencia cambió). | **hecho** (28-09-2026) |
| 1.5 | Verificador activo de citas y "hecho exige evidencia" (`block`): revisión de citas en informes de subagentes, puerta sobre casillas de planes, rechazo de evidencia circular, `knowledge check` de deriva. Detalle: `plans/citation-gate.md`. | **hecho** (28-09-2026); revisión de citas de subagentes confirmada en vivo |
| 1.6 | **Compactación sin pérdida.** (a) *Medir primero:* forzar compactaciones en sesiones de prueba y comprobar qué se pierde (peticiones literales, restricciones, decisiones, archivos:línea, errores vistos, preguntas abiertas). (b) *Instantánea antes de compactar:* extraer por código ese estado crítico y guardarlo en el índice con su puntero `ses_… → msg_… → prt_…` (las peticiones y restricciones del usuario, **siempre literales**). (c) *Resumen con anclas:* cada punto del resumen lleva el puntero a su origen. (d) *Verificación después:* comparar el resumen con la instantánea y reinyectar lo que falte, sin duplicar lo que ya está. (e) *Rehidratación mínima:* tras compactar, una tarjeta de estado corta + "busca en el índice para el detalle", en vez de reinyectar documentos enteros. | **hecho** (28-09-2026): recuerdo 10/10 con y sin el modo (empate en el techo con big-pickle); con el modo, 12 locators literales en el resumen frente a 0, resumen ~2× más largo; tarjeta inyectada en vivo. Se integra activado por decisión del usuario. `plans/lossless-compaction.md` |

## Fase 2 — Orquestador + especialistas con herramientas obligatorias
| Paso | Qué | Estado |
|---|---|---|
| 2.1 | **Taxonomía de tareas atómicas y matriz de enrutamiento** (solo análisis + plan): para cada tipo de tarea (buscar en código, investigar en la web/docs, planear, escribir código, escribir docs, revisar tests/seguridad/arquitectura, depurar, UI) → especialista → herramientas **obligatorias** → contrato de salida (resumen + fuentes) → cómo se verifica. Comparando uno a uno tus agentes con los del plugin para quedarnos con el mejor de cada papel. | **hecho** (29-09-2026): orquestadores con Tab + especialistas atómicos; planes en `.omo/plans/`; guardas que bloquean; el orquestador verá los agentes personalizados. `plans/task-routing.md` |
| 2.2 | Unificar el plantel según 2.1: fusionar/reemplazar agentes, y que el orquestador **conozca** los especialistas personalizados (arreglar `_customAgentSummaries`). | pendiente |
| 2.3 | `@investigador-web` optimizado: docs oficiales primero (context7, sitio oficial, versión), búsquedas amplias→estrechas, varias herramientas en paralelo, citas con URL obligatorias y **verificadas** al volver. | pendiente |
| 2.4 | **Enrutamiento obligatorio por código:** reglas en `tool.execute.before` (p. ej. mencionar una librería externa ⇒ investigar antes de editar; el orquestador no busca en la web él mismo) que **bloquean** en vez de avisar. | pendiente |
| 2.5 | Skills obligatorias por categoría (`skills` en `CategoryConfigSchema`). | pendiente |
| 2.6 | Contrato de salida verificado para todos los subagentes: resumen + fuentes; si falta, se devuelve al subagente. | pendiente |
| 2.7 | **Guardián de reglas**: reglas de proyecto y de carpeta llevadas al momento de editar (bloqueo una vez + recordatorio), que vuelven tras compactar, comprobables por código (`forbid`), en el prompt de los subagentes, y especialista `rules-checker`. `plans/rules-guardian.md` | plan |
| 2.9 | **Absorber la biblioteca de reglas en el plugin**: evaluar regla a regla de `ai-guidelines` y del `AGENTS.md` global; se aplica solo si es la mejor opción (si el plugin o la investigación tienen algo mejor, se descarta con motivo). Cada regla va donde se usa: comportamiento general compacto en los orquestadores, reglas de tarea en su especialista/skill, reglas de tema o lenguaje (REST, Go, PHP/Laravel, Next, Nuxt) solo si el proyecto usa ese stack y al tocar esos archivos (vía 2.7). Objetivo: dejar de cargar ~26k tokens de reglas en cada agente. | plan |
| 2.8 | **Lectura de código eficiente**: `explore` mejorado + herramientas `code_outline`, `read_symbol`, `repo_map`, `callers`; Graphify opcional (se usa si está instalado). Investigación en `plans/specialists-research.md` | plan |

## Fase 3 — Medir que mejora
| Paso | Qué | Estado |
|---|---|---|
| 3.1 | Banco de pruebas pequeño con tareas reales: mide citas inventadas, uso de herramientas obligatorias, **datos perdidos tras compactar**, costo y tiempo, antes/después de cada fase. | pendiente |

## Aparcado (decidido no hacer por ahora)
- Reglas de lenguaje/framework cargadas bajo demanda (ahorraría gran parte de ~24.5k tokens por sesión). — 27-09-2026

## Registro de decisiones del roadmap
- 27-09-2026 — Código dentro del plugin; decisiones versionadas en `docs/decisions/`; "hecho" exige evidencia
  (`block`); indexar sesiones: sí; todo activado por defecto.
- 27-09-2026 — No elegir entre tus agentes y los del plugin: quedarse con el mejor de cada papel (paso 2.1).
- 27-09-2026 — Añadido 1.6: la compactación no debe perder peticiones, restricciones, decisiones ni pendientes.
- 29-09-2026 — Misión del fork fijada; añadido 2.9 (absorber la biblioteca con criterio "solo lo mejor"); `@planning`/`@running` y los 4 revisores del usuario se archivan: sus reglas útiles ya están absorbidas o planificadas, el resto se descarta.
- 29-09-2026 — Añadidos 2.7 (guardián de reglas) y 2.8 (lectura de código eficiente), con investigación por especialista.
- 29-09-2026 — 2.1 hecho: matriz de enrutamiento y arquitectura objetivo (orquestadores + especialistas).
- 29-09-2026 — 0.2 hecho: borrar equipos colgados desde otra ejecución (herramienta + CLI).
- 28-09-2026 — 1.6 hecho: sin mejora medible de recuerdo en el banco (ambos 10/10), pero con citas exactas de cada mensaje del
  usuario; el usuario eligió integrarlo activado.
- 28-09-2026 — Decisiones: se mantiene un `.md` por decisión (estándar ADR); el plan pasa a enlaces generados; se añaden vistas,
  validación y la inyección de decisiones al tocar archivos (1.4b, 1.4c). Registro: `docs/decisions/`.
