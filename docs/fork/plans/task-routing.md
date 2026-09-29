# Paso 2.1 — Taxonomía de tareas y matriz de enrutamiento

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **análisis hecho, decisiones tomadas (29-09-2026)**. Solo análisis y
plan: no cambia código. Rutas: `S/` = `packages/omo-opencode/src/`, `U/` = `~/.config/opencode/`.

## Decisiones del usuario (29-09-2026)
- **D1** Los planes viven en `.omo/plans/`, con la plantilla del usuario (Gherkin, Decisions log, fuentes).
- **D2** Absorber de los agentes del usuario **solo lo que aporte**. Objetivo: **orquestadores** que se alternan con Tab en
  OpenCode y que delegan cada tarea atómica en **especialistas** (p. ej. `@busqueda-web`), lo más eficientes posible.
- **D3** Los guardas de 2.4 **bloquean** (el orquestador delega; no edita código ni busca en la web por sí mismo).
- **D4** El orquestador debe conocer los agentes personalizados (arreglar `_customAgentSummaries`).

## 1. Qué hay hoy

### Agentes del plugin
| Agente | Papel | Herramientas (código) | Contrato de salida (solo prompt) |
|---|---|---|---|
| Sisyphus / Hephaestus | Orquestador principal (Claude / GPT) | `question` sí, `call_omo_agent` no (`S/agents/sisyphus-agent-config.ts:9-14`) | ninguno fijo |
| Prometheus (+ Metis antes, Momus después) | Planificador | escribe solo `.omo/*.md` (`S/hooks/prometheus-md-only/hook.ts:40-62`) | plan en `.omo/plans`; Momus `[OKAY]/[REJECT]` + ≤3 bloqueos (`S/agents/momus.ts:177-189`) |
| Atlas | Ejecuta la lista de tareas del plan | sin restricciones | ninguno |
| Sisyphus-Junior + categoría | Ejecutor de cada tarea delegada | `task` no; solo llama a explore/librarian | ninguno |
| explore | Buscar en el código | solo lectura + LSP (`S/agents/explore.ts:28-31`) | `<results><files><answer><next_steps>` con rutas absolutas (`explore.ts:53-99`) |
| librarian | Docs externas / OSS | solo lectura; MCP websearch (Exa), context7, grep_app (`S/mcp/index.ts:29-53`) | cada afirmación con permalink (`S/agents/librarian.ts:208-236`) |
| oracle | Consejero de depuración/arquitectura | solo lectura | conclusión, plan, esfuerzo, riesgos (`S/agents/oracle.ts:82-97`) |
| multimodal-looker | PDFs/imágenes | solo `read` | lo extraído, sin preámbulo |

Categorías (todas corren como Sisyphus-Junior; `S/tools/delegate-task/category-resolver.ts:296`): `visual-engineering`,
`artistry`, `ultrabrain`, `deep-low`, `deep-high`, `quick`, `unspecified-low`, `unspecified-high`, `writing`.

### Agentes del usuario (`U/agents/`) y qué aportan de verdad
| Agente | Lo que aporta que el plugin no tiene | ¿Se absorbe? |
|---|---|---|
| @planning | Gherkin falsable por subtarea; Decisions log con reversibilidad; investigación web **acotada** (2-3 búsquedas, fuentes de confianza) citada en las decisiones; no decide arquitectura sola (`U/agents/planning.md:39-110`) | **Sí, como reglas** de Prometheus |
| @running | Casilla solo con evidencia real; test en rojo antes del arreglo; parar en el primer fallo; "preguntar antes" de lo destructivo (`U/agents/running.md:62-153`) | **Sí, como reglas** de Atlas y de los ejecutores |
| 4 revisores | Revisión de **diff** con skill obligatoria y formato Issue / Ubicación / Severidad / Recomendación; security trata web y repo como datos (`U/agents/security-reviewer.md:52-54`) | **Sí, como especialistas** (el plugin no tiene revisores de código) |

### Huecos verificados en el código
1. **El orquestador no conoce los agentes personalizados.** `_customAgentSummaries` se rellena
   (`S/plugin-handlers/agent-source-loader.ts:31-52`) pero `createBuiltinAgents` no lo usa (`S/agents/builtin-agents.ts:69`),
   y un test fija ese comportamiento (`S/agents/custom-agent-orchestrator-visibility.test.ts:7-38`).
2. **Las categorías no pueden exigir skills** (`S/config/schema/categories.ts:5-41` no tiene `skills`). El enum aún lista
   `deep` (`categories.ts:46`), sustituido por `deep-low`/`deep-high`.
3. **Casi todo es prompt, no código.** Formatos de salida, citas y "elige categoría y skills" no se comprueban. Solo Atlas
   tiene un freno a editar por su cuenta y **solo avisa** (`S/hooks/atlas/tool-execute-before.ts:85-129`).
4. **Las URLs no se verifican**: `citation-check` valida `archivo:línea`, commits y sesiones, no URLs.
5. **Posible hueco en Prometheus**: el bloqueo solo cubre `write`/`edit` (`S/hooks/prometheus-md-only/constants.ts:12`), no
   `apply_patch`, `multiedit` ni `hashline_edit`. Se comprueba en 2.4.
6. **Agentes del usuario**: @test-reviewer debe ejecutar tests pero no tiene `bash`; context7 está configurado pero ningún
   prompt lo nombra; `redux` y `dotnet-ddd-cqrs-api` se citan pero no están instaladas.

## 2. Arquitectura objetivo (D2)

```
Tab ⇄  Orquestadores (primarios)            Especialistas atómicos (subagentes)
       ─────────────────────────            ────────────────────────────────────
       Sisyphus   (hacer de todo)    ──▶     @busqueda-codigo   (explore)
       Prometheus (planear)          ──▶     @busqueda-web      (librarian mejorado)
       Atlas      (ejecutar un plan) ──▶     @memoria           (decisiones y chats)
                                             @implementador-*   (categorías: quick, deep, visual…)
                                             @escritor          (writing)
                                             @revisor-tests / -lenguaje / -seguridad / -arquitectura
                                             @consejero         (oracle)
                                             @lector-multimodal (multimodal-looker)
```

- Los orquestadores **no** hacen tareas atómicas: lo impide el código (D3). Con Tab eliges el modo de trabajo; cada uno
  reparte a los mismos especialistas.
- Cada especialista tiene herramientas **obligatorias** y un **contrato de salida** que se comprueba por código.
- Los nombres son propuesta; se fijan en 2.2. Hephaestus (orquestador para modelos GPT) se decide en 2.2 según si aporta.

## 3. Matriz de enrutamiento

| # | Tipo de tarea | Especialista | Herramientas **obligatorias** | Contrato de salida | Verificación por código |
|---|---|---|---|---|---|
| 1 | Buscar en el código | @busqueda-codigo | `knowledge_search` + grep/glob/LSP | respuesta + `archivo:línea` por afirmación | `citation-check` (existe) |
| 2 | Recordar el porqué | @memoria | `decision_search`, `knowledge_search` | locators `D-…` / `ses_…/msg_…` | `citation-check` (existe) |
| 3 | Investigar fuera (librería, API, práctica) | @busqueda-web | context7 si es librería conocida; `websearch` → `webfetch` de la doc oficial; versión | cada afirmación con URL (+ versión) y "fuente — por qué importa" | **nuevo (2.6)**: URL por afirmación y alcanzable; si falta, vuelve al subagente |
| 4 | Planear | Prometheus (+ Metis, Momus) | lectura del código; fila 3 si la tarea es grande | plan con Gherkin, Decisions log y fuentes en `.omo/plans/` | Momus `[OKAY]` + revisores en modo plan |
| 5 | Implementar | @implementador-* (categoría) | edición + tests; **skills de la categoría** (2.5) | archivos tocados + comandos con su salida real | `evidence-gate` (existe) |
| 6 | Escribir docs | @escritor | lectura de lo que resume | texto + fuentes citadas | `citation-check` |
| 7 | Revisar tests / lenguaje / seguridad / arquitectura | @revisor-* | skill de su esquina + `git diff` | Issue / Ubicación / Severidad / Recomendación | no se cierra con críticos abiertos (2.6) |
| 8 | Depuración difícil / arquitectura | @consejero → @implementador-deep | lectura + reproducción | causa raíz con `archivo:línea` + test que falla antes | `evidence-gate` |
| 9 | UI | @implementador-visual | skill `ui-ux-pro-max` | cambios + evidencia | `evidence-gate` |
| 10 | PDFs / imágenes | @lector-multimodal | `read` | lo extraído | — |

## 4. Reparto en los pasos siguientes
- **2.2 Plantel**: especialistas con nombre y descripción claros; revisores empaquetados (con `bash` de solo tests para el de
  tests); reglas de @planning en Prometheus y de @running en Atlas y los implementadores; los orquestadores ven también los
  agentes personalizados (D4, cambiando el test del upstream).
- **2.3 @busqueda-web**: docs oficiales primero, búsquedas amplias→estrechas, herramientas en paralelo, citas con URL.
- **2.4 Guardas que bloquean (D3)**: orquestadores sin edición de código ni web directa (excepto archivos del plan); cerrar
  el posible hueco de Prometheus.
- **2.5 Skills obligatorias** por categoría (`skills` en `CategoryConfigSchema`); corregir el enum `deep`.
- **2.6 Contratos de salida verificados** (URLs, formato de hallazgos, críticos abiertos) con reenvío al subagente.
- **3.1 Banco de evaluación** para medir que el enrutamiento mejora las respuestas y reduce alucinaciones.
