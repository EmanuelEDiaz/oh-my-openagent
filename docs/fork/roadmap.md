# Roadmap del fork — agentes especializados, fundamentados y citables

Estado: **vivo**. Se actualiza al cerrar cada paso. Rutas: `S/` = `packages/omo-opencode/src/`.

## Objetivo
Una sola estructura que se quede con **lo mejor** de oh-my-openagent y de tu biblioteca/agentes, donde:
1. Un orquestador descompone cada tarea en **tareas atómicas** y las envía al **especialista** adecuado.
2. Cada especialista está optimizado para su tipo de tarea y usa **obligatoriamente** las herramientas que esa
   tarea exige (p. ej. investigar en la web antes de usar una librería externa).
3. Todo lo que se afirma es **citable y verificable**: archivo:línea, commit, URL o puntero de chat
   (`ses_… → msg_… → prt_…`), con un índice eficiente que controla su crecimiento y se poda.
4. Se avanza **paso a paso**: cada paso tiene análisis, plan detallado aprobado, implementación, QA real y merge.

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
- **Bug de pérdida de datos** en worktrees del modo team (`rm -rf` sobre rutas no creadas por omo).
- Varios `AGENTS.md` internos están desactualizados (p. ej. dicen que Atlas no puede usar `task`).

## Cómo se trabaja cada paso
`análisis → plan detallado en docs/fork/plans/<paso>.md (criterios Gherkin) → tu aprobación →
rama propia → test RED → implementación → tests → QA real en OpenCode aislado → evidencia local →
merge --no-ff a mis-mejoras → actualizar este roadmap`.

---

## Fase 0 — Seguridad
| Paso | Qué | Estado | Plan |
|---|---|---|---|
| 0.1 | Worktrees seguros: no borrar nunca rutas que omo no creó; worktrees reales con git; no borrar trabajo sin guardar. | plan listo, **siguiente** | `plans/knowledge-base-and-worktrees.md` (Pieza 4) |

## Fase 1 — Fundamento: índice, citas de chat y decisiones
| Paso | Qué | Estado |
|---|---|---|
| 1.1 | **Diseño del índice y su ciclo de vida** (solo análisis + plan): qué se indexa, formato de locator, presupuesto de tamaño, poda (capas resume/cold/orphan de tu biblioteca), `optimize`/`VACUUM`, qué pasa al borrar sesiones, rendimiento medido. | pendiente |
| 1.2 | Índice del proyecto (`.omo/knowledge.db`, FTS5 + BM25) + herramienta `knowledge_search` con locators citables. | pendiente |
| 1.3 | **Citas de chat:** indexado de sesiones leyendo `opencode.db` en solo lectura (tu método validado), puntero `ses_… → msg_… → prt_…`, comando de re-auditoría, poda de sesiones borradas y "una sesión vive si algo la referencia". | pendiente |
| 1.4 | Decisiones citadas en tu formato (`docs/decisions/` + Decisions log del plan activo). | plan listo (Pieza 2) |
| 1.5 | Verificador de citas + "hecho exige evidencia" (modo `block`). | plan listo (Pieza 3) |

## Fase 2 — Orquestador + especialistas con herramientas obligatorias
| Paso | Qué | Estado |
|---|---|---|
| 2.1 | **Taxonomía de tareas atómicas y matriz de enrutamiento** (solo análisis + plan): para cada tipo de tarea (buscar en código, investigar en la web/docs, planear, escribir código, escribir docs, revisar tests/seguridad/arquitectura, depurar, UI) → especialista → herramientas **obligatorias** → contrato de salida (resumen + fuentes) → cómo se verifica. Comparando uno a uno tus agentes con los del plugin para quedarnos con el mejor de cada papel. | pendiente |
| 2.2 | Unificar el plantel según 2.1: fusionar/reemplazar agentes, y que el orquestador **conozca** los especialistas personalizados (arreglar `_customAgentSummaries`). | pendiente |
| 2.3 | `@investigador-web` optimizado: docs oficiales primero (context7, sitio oficial, versión), búsquedas amplias→estrechas, varias herramientas en paralelo, citas con URL obligatorias y **verificadas** al volver. | pendiente |
| 2.4 | **Enrutamiento obligatorio por código:** reglas en `tool.execute.before` (p. ej. mencionar una librería externa ⇒ investigar antes de editar; el orquestador no busca en la web él mismo) que **bloquean** en vez de avisar. | pendiente |
| 2.5 | Skills obligatorias por categoría (`skills` en `CategoryConfigSchema`). | pendiente |
| 2.6 | Contrato de salida verificado para todos los subagentes: resumen + fuentes; si falta, se devuelve al subagente. | pendiente |

## Fase 3 — Medir que mejora
| Paso | Qué | Estado |
|---|---|---|
| 3.1 | Banco de pruebas pequeño con tareas reales: mide citas inventadas, uso de herramientas obligatorias, costo y tiempo, antes/después de cada fase. | pendiente |

## Aparcado (decidido no hacer por ahora)
- Reglas de lenguaje/framework cargadas bajo demanda (ahorraría gran parte de ~24.5k tokens por sesión). — 27-09-2026

## Registro de decisiones del roadmap
- 27-09-2026 — Código dentro del plugin; decisiones versionadas en `docs/decisions/`; "hecho" exige evidencia
  (`block`); indexar sesiones: sí; todo activado por defecto.
- 27-09-2026 — No elegir entre tus agentes y los del plugin: quedarse con el mejor de cada papel (paso 2.1).
