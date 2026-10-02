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
- Para ver si un test falla de verdad, ejecutarlo **solo**: varias carpetas comparten `mock.module` y se contaminan al
  ejecutarse juntas (comment-checker, auditoría de mocks bajo carga).
- El plan gratuito de Zen devuelve a veces 403 "free tier can only be used from within OpenCode" de forma intermitente,
  a cualquier agente; no sacar conclusiones de una sola ejecución (comparar varias). Los modelos `*-free` de la caché
  pueden no existir ya en el proveedor.
- Muchas ejecuciones seguidas agotan los modelos gratuitos ("Insufficient account funds", "Rate limit exceeded"): activar
  `runtime_fallback` con una cadena de varios modelos en el sandbox y espaciar las pruebas.

## Fase 0 — Seguridad y robustez
| Paso | Qué | Estado | Plan |
|---|---|---|---|
| 0.1 | Worktrees seguros: no borrar nunca rutas que omo no creó; worktrees reales con git; no borrar trabajo sin guardar. | **hecho** (27-09-2026, rama `fix/team-worktree-safety`) | `plans/knowledge-base-and-worktrees.md` (Pieza 4) |
| 0.2 | Borrar equipos desde otra ejecución: `team_delete` exige la sesión líder pero ese registro vive en memoria y se pierde entre procesos (`opencode run`), dejando equipos y worktrees huérfanos. Hallado en la QA de 0.1. | **hecho** (29-09-2026): mensaje con la sesión líder y cómo seguir; CLI `team list` / `team delete [--force] [--dry-run]`; cualquier sesión puede forzar el borrado de equipos huérfanos o atascados. `plans/team-delete-cross-process.md` |
| 0.3 | **Ningún agente desaparece por su modelo**: Atlas se descarta sin aviso en el primer arranque o sin modelos de su cadena, y otros arrancan con modelos de pago sin credencial. Degradar (registrar sin modelo → usa el de la sesión) + aviso visible + big-pickle en la cadena de Atlas. `plans/robustness-fixes.md` | **hecho** (01-10-2026); hallazgo: con caché se eligen modelos de pago que fallan en cuentas gratuitas → propuesta "solo modelos gratuitos" |
| 0.4 | **Prometheus solo escribe `.omo/*.md`**: hoy `apply_patch`, `hashline_edit rename` y `lsp_rename` lo esquivan y sin ruta deja pasar. Bloquear todas las vías y fallar cerrado. `plans/robustness-fixes.md` | **hecho** (01-10-2026); QA en vivo no concluyente por el 403 intermitente del plan gratuito, guarda demostrada por tests |
| 0.5 | **Preferir modelos gratuitos (sin imponer)**: con la caché de proveedores la resolución automática elige modelos de pago que el proveedor lista (Zen: `opencode/claude-opus-5-5`…), que fallan en cuentas gratuitas. Opción `prefer_free_models` (activada en la config del usuario): la resolución **automática** (cadenas y respaldos) salta los modelos con coste según el precio de la caché de OpenCode; **lo elegido en `/omo-models` (o `agents.<x>.model`/`fallback_models`) siempre manda**, aunque sea de pago. | **hecho** (01-10-2026); activado en la config del usuario |
| 0.6 | **`doctor` y tests fiables** (decidido 01-10-2026): (a) `doctor` consciente del fork — sin la falsa alarma "not registered" con `file://` y **sin recomendar nunca** `bun add oh-my-openagent@latest`, que reemplazaría el fork; (b) su sección de modelos aplica la degradación (0.3) y la preferencia por gratuitos (0.5); (c) los 3 tests del upstream que dependen de la máquina pasan a ser herméticos; (d) diagnosticar por qué no se descargó el binario del comment-checker y avisarlo claramente. `sisyphus-junior` → `anthropic/…` queda fuera (al usuario no le afecta: tiene modelo propio). | **hecho** (01-10-2026): sin falsas alarmas ni consejos que reemplacen el fork; vista de modelos real (◌ = modelo de la sesión); comment-checker "aún no descargado" vs "falló"; 3 tests herméticos. Evidencia en `.omo/evidence/20261001-doctor-fork-aware/` |
| 0.7 | **Modelos retirados** (decidido 01-10-2026, hallado en el piloto de 3.0): OpenCode borra los modelos que models.dev marca `deprecated`, y un agente con ese modelo falla al delegar ("Model not found"), sin probar sus `fallback_models`. (a) Al arrancar, comprobar cada modelo configurado contra los que OpenCode ofrece de verdad y avisar nombrando los agentes y `/omo-models`. (b) Al ejecutar, saltar al siguiente `fallback_models` que exista y, si no queda ninguno, al modelo de la sesión (como 0.3), sin fallar la tarea. (c) `/omo-models` ya los marca y no los ofrece (solo se verifica). El usuario elige él mismo los modelos nuevos con `/omo-models`. | **hecho** (01-10-2026): un modelo retirado nunca se usa si la lista es conocida (respaldo → cadena gratuita → sesión, con aviso); QA real: explore pasa con tu config. Límite: primer arranque sin caché. Evidencia en `.omo/evidence/0.7/` |
| 0.8 | **Cuelgues silenciosos del modelo** (pedido 02-10-2026, hallado en el banco de 3.0/4.1): a veces un modelo gratuito deja de emitir a mitad, sin error; OpenCode espera indefinidamente y, al abortar, el servidor llegó a dejar de responder. El banco ya lo detecta (240 s sin avance) y reinicia el servidor, pero en el uso real nadie lo corta ni avisa. Objetivo: detectarlo en el plugin, avisar (al usuario y al modelo/orquestador) y reintentar con el siguiente modelo de respaldo. Decidido (02-10-2026): A `chunkTimeout` 90 s por defecto + B vigilante a los 4 min sin tokens ni herramienta/proceso en marcha (avisa, informa al modelo, reintenta con respaldo); **procesos largos en segundo plano con `wait_for` y aviso, obligatorios y bloqueados por código en `bash`** (adelantado desde 4.14). | en curso (0.8a) — `plans/stall-processes-resume.md` (diseño aprobado), `plans/robustness-fixes.md`, `plans/bounded-retry-resume.md` |
| 0.9 | **Integridad de tests, rompe-bucles y errores de tipos** (pedido 02-10-2026): por código, no solo prompts. Tests existentes de solo lectura durante un arreglo y revisión del diff (skip, aserciones debilitadas, mocks del módulo, `any`/`ts-ignore`); test nuevo válido solo si falla antes y pasa después; rompe-bucles con huella de error (2 aviso / 3 empezar de cero + búsqueda en Stack Exchange, issues de GitHub, Exa y SearXNG opcional / 4 bloquear y preguntar al usuario con opciones); diagnósticos de tipos nuevos tras cada edición. Mejoras de agentes en 4.7, 4.8 y 4.11. | decidido — `plans/test-integrity-and-loops.md`, `plans/bounded-retry-resume.md` |
| 0.10 | **Ver las tareas en segundo plano** (pedido 02-10-2026): (1) marcar la tarea delegada como `background` para que la llamada muestre progreso y última acción en vivo; (2) `/bg` + `ctrl+x b` con la lista de tareas en marcha y Enter para entrar en su sesión; (3) panel lateral "Jobs" con clic que abre la sesión y línea de acción actual; (4/5) documentar tmux (`tmux.enabled`, OpenCode con `--port`) y `opencode attach -s` desde otra terminal. Hoy ya funciona `ctrl+x ↓` / `→` / `ctrl+x ↑` para entrar en las sesiones hijas. | decidido — tras 0.8 y 0.9 |
| 0.11 | **Windows nativo** (decidido 02-10-2026): el plugin funciona en Windows y Linux; regla para todo lo nuevo (sin `sh -c`/`grep`/`tar`/`kill(-pid)`, utilidades del repo para procesos y rutas) y corrección de lo del plugin que no sea multiplataforma (p. ej. patrones `command -v`/`which` de los especialistas); pruebas en el CI de Windows. Las herramientas de desarrollo (banco) pueden exigir Linux/WSL/Git Bash. | decidido — `plans/computer-use.md` |

## Fase 1 — Fundamento: índice, citas de chat y decisiones
| Paso | Qué | Estado |
|---|---|---|
| 1.1 | **Diseño del índice y su ciclo de vida** (solo análisis + plan): qué se indexa, formato de locator, presupuesto de tamaño, poda (capas resume/cold/orphan de tu biblioteca), `optimize`/`VACUUM`, qué pasa al borrar sesiones, rendimiento medido. | **hecho** (28-09-2026; implementado en 1.2–1.3): `plans/knowledge-index.md` |
| 1.2 | Índice del proyecto (`.omo/cache/knowledge.db`, FTS5 + BM25) + herramienta `knowledge_search` con locators citables. | **hecho** (28-09-2026) |
| 1.3 | **Citas de chat:** indexado de sesiones leyendo `opencode.db` en solo lectura (tu método validado), puntero `ses_… → msg_… → prt_…`, comando de re-auditoría, poda de sesiones borradas y "una sesión vive si algo la referencia". + `knowledge_open` y `knowledge report [--vacuum]`. | **hecho** (28-09-2026) |
| 1.3b | Que el `session_search` antiguo (subcadena, sin ranking) use el índice o remita a `knowledge_search`: en la QA el agente lo probó primero y no encontró nada. | **hecho** (28-09-2026) |
| 1.4 | Decisiones citadas en tu formato (`docs/decisions/` + Decisions log del plan activo). | **hecho** (28-09-2026): `decision_record`/`decision_search`, verificador de citas, bloque `<grounding>` en los prompts, Atlas relee `decisions.md` |
| 1.4b | **Decisiones que escalan:** el plan guarda enlaces (bloque generado entre marcadores) en vez de copias; vista `knowledge decisions`; campo `area`; validación del esquema; carpetas por año al superar ~200. Análisis y fuentes en `plans/decisions-scaling.md`. | **hecho** (28-09-2026) |
| 1.4c | **Las decisiones encuentran al agente:** al leer/editar un archivo citado por una decisión activa, se inyecta una línea con esa decisión (una vez por sesión, con aviso si la evidencia cambió). | **hecho** (28-09-2026) |
| 1.5 | Verificador activo de citas y "hecho exige evidencia" (`block`): revisión de citas en informes de subagentes, puerta sobre casillas de planes, rechazo de evidencia circular, `knowledge check` de deriva. Detalle: `plans/citation-gate.md`. | **hecho** (28-09-2026); revisión de citas de subagentes confirmada en vivo |
| 1.6 | **Compactación sin pérdida.** (a) *Medir primero:* forzar compactaciones en sesiones de prueba y comprobar qué se pierde (peticiones literales, restricciones, decisiones, archivos:línea, errores vistos, preguntas abiertas). (b) *Instantánea antes de compactar:* extraer por código ese estado crítico y guardarlo en el índice con su puntero `ses_… → msg_… → prt_…` (las peticiones y restricciones del usuario, **siempre literales**). (c) *Resumen con anclas:* cada punto del resumen lleva el puntero a su origen. (d) *Verificación después:* comparar el resumen con la instantánea y reinyectar lo que falte, sin duplicar lo que ya está. (e) *Rehidratación mínima:* tras compactar, una tarjeta de estado corta + "busca en el índice para el detalle", en vez de reinyectar documentos enteros. | **hecho** (28-09-2026): recuerdo 10/10 con y sin el modo (empate en el techo con big-pickle); con el modo, 12 locators literales en el resumen frente a 0, resumen ~2× más largo; tarjeta inyectada en vivo. Se integra activado por decisión del usuario. `plans/lossless-compaction.md` |


## Fase 2 — Orquestador + especialistas: diseño y plantel
| Paso | Qué | Estado |
|---|---|---|
| 2.1 | **Taxonomía de tareas atómicas y matriz de enrutamiento** (solo análisis + plan): para cada tipo de tarea (buscar en código, investigar en la web/docs, planear, escribir código, escribir docs, revisar tests/seguridad/arquitectura, depurar, UI) → especialista → herramientas **obligatorias** → contrato de salida (resumen + fuentes) → cómo se verifica. Comparando uno a uno tus agentes con los del plugin para quedarnos con el mejor de cada papel. | **hecho** (29-09-2026): orquestadores con Tab + especialistas atómicos; planes en `.omo/plans/`; guardas que bloquean; el orquestador verá los agentes personalizados. `plans/task-routing.md` |
| 2.2 | Unificar el plantel según 2.1: fusionar/reemplazar agentes, y que el orquestador **conozca** los especialistas personalizados (arreglar `_customAgentSummaries`). | **hecho** (29-09-2026): 13 especialistas + marca obligatorio/opcional, agentes personalizados visibles, política de ejecución de Atlas, agentes del usuario archivados. `plans/specialists-catalog.md` |

Los antiguos pasos transversales 2.3–2.11 se reparten en la Fase 4, dentro del especialista al que pertenecen
(decisión del 01-10-2026; tabla de equivalencias abajo). Su contenido y sus planes no cambian.

## Fase 3 — Banco de pruebas (antes de mejorar ningún agente)
| Paso | Qué | Estado |
|---|---|---|
| 3.0 | **Banco de pruebas** propio en Bun (sin dependencias nuevas): OpenCode aislado y reutilizable, especialistas ejecutados como subagentes de verdad (parte `subtask` del SDK), correctores deterministas comunes (resultado en el repo, contrato `<report>`, herramienta obligatoria usada / prohibida no usada, **citas que existen** —archivo:línea, URL, versión de paquete—, tokens, coste, tiempo, turnos), pass@1 y pass^3, fallos de infraestructura (403, límites) separados de los del agente; modelos de `/omo-models`, agnóstico de proveedor. Incluye la parte de 2.6 que verifica contratos. | **hecho** (01-10-2026): banco en `script/fork/bench/` (44 tests), piloto `explore` 9/9 con `big-pickle`, informe en `docs/fork/evals/explore.md`; detecta cuelgues de modelos gratuitos y servidores que no responden; `regrade.ts` re-puntúa sin modelo. Evidencia en `.omo/evidence/3.0/` |

## Fase 4 — Especialistas uno a uno (plantilla común)
Cada paso: investigar → contrato → 15–30 tareas (+30 % reservado) → medición base → análisis de fallos reales → 2–4
mejoras de una en una → nueva medición → evidencia antes/después → casos aprobados pasan a la suite de regresión.
Orden por impacto (los que alimentan a todos, luego los "porteros", luego los que escriben, los orquestadores al final).

| Paso | Agente(s) | Incluye | Estado |
|---|---|---|---|
| 4.1 | `explore` | lectura de código eficiente (antes 2.8): 3 herramientas `code_map`, `code_symbols` (esquema + lectura de un símbolo), `code_callers`; motor ast-grep ya descargado + LSP (decidido 01-10-2026); Graphify opcional como pistas; procedimiento fijo en el prompt; `bash` de solo lectura; banco de 24 tareas (7 reservadas) en el fork, `ts-service` y 2 repos públicos | en curso — `plans/explore.md` |
| 4.2 | `librarian` + `api-lookup` | investigación web (antes 2.3): búsqueda gratuita, docs oficiales primero, citas literales verificadas, versión instalada | pendiente |
| 4.3 | `memory` | calidad del recuerdo de decisiones y chats; ocultación de secretos en el índice | pendiente |
| 4.4 | `verifier` | contrato `<report>` comprobado en ejecución (resto de 2.6), estado `FLAKY`, comparación con la base | pendiente |
| 4.5 | `rules-checker` + guardián de reglas | antes 2.7 + **creación interactiva de reglas** + absorción de la biblioteca (antes 2.9) y reglas por stack | pendiente — `plans/rules-guardian.md` |
| 4.6 | `security-reviewer` | credenciales y guarda de destrucción (antes 2.11), escáneres gratuitos | pendiente — `plans/credentials.md` |
| 4.7 | `test-writer` | test en rojo por la razón correcta, valores esperados desde la especificación | pendiente |
| 4.8 | `debugger` | reproducción, `git bisect run`, bucle hipótesis/experimento | pendiente |
| 4.9 | `git-committer` → **especialista de control de versiones** | commits + ramas + merge, push/rebase solo con aprobación; reglas generales + política por proyecto; **identidad del proyecto preguntada y confirmada en cada sesión, nunca la global** (ordenador compartido); comprobado por código | pendiente — `plans/version-control.md` |
| 4.10 | `dependency-check` | registro + OSV + deps.dev, señales de "slopsquatting" | pendiente |
| 4.11 | `test-reviewer`, `lang-reviewer`, `architect-reviewer` | precisión/recall con diffs con fallos sembrados | pendiente |
| 4.12 | `docs-writer` | afirmaciones que apuntan al código, Diátaxis, CHANGELOG | pendiente |
| 4.13 | `ui-tester` | instantáneas de accesibilidad, consola, capturas solo si hacen falta; **navegador seguro** (Playwright MCP `--isolated`, `ui-tester` con cualquier proveedor, capa de seguridad de `plans/computer-use.md`); **UI fiel al código**: capturar la app real, mapa de ids ruta→componente→`archivo:línea`→nodo del diseño, comparación por código (sirve sin visión); skill "diseño desde la UI real" para Pencil, Figma o HTML | pendiente — `plans/ui-fidelity.md` |
| 4.14 | Implementadores (categorías) | skills obligatorias por categoría (antes 2.5); los procesos gestionados (antes 2.10) pasan a 0.8 | pendiente — `plans/process-lifecycle.md` |
| 4.15 | `multimodal-looker`, `metis`, `momus`, `oracle` | — | pendiente |
| 4.16 | Orquestadores: Prometheus, Atlas, Sisyphus | enrutamiento obligatorio por código y presupuesto de lectura (antes 2.4); calidad de plan, ejecución y delegación; **planes visuales**: Mermaid/SVG como código con `archivo:línea`, validados por código, skill `visual-plan` y herramienta `plan_render` (HTML) | pendiente — `plans/visual-plans.md` |
| 4.17 | **Control del escritorio con IA** (decidido 02-10-2026): llevar a OpenCode el motor propio `senpi-desktop` (Rust; Windows UIA, Linux X11/Wayland/AT-SPI) con una herramienta `computer` basada en árbol de texto y referencias (sirve para modelos sin visión); aislamiento por defecto (Xephyr en Linux, usuario aparte o Windows Sandbox en Windows); capa de control y seguridad (parada y pausa, listas permitidas, aprobación de acciones irreversibles, texto de pantalla como datos, auditoría); ≤ 6 herramientas, comprobación tras cada acción, 15–25 pasos y reanudación; respaldos OCR (tesseract.js) y visión puntual con modelo gratuito. | pendiente — `plans/computer-use.md` |

**Equivalencias con la numeración anterior:** 2.3→4.2 · 2.4→4.16 · 2.5→4.14 · 2.6→3.0 + 4.4 · 2.7→4.5 · 2.8→4.1 ·
2.9→4.5 · 2.10→4.14 · 2.11→4.6 · 3.1→5.1.

## Fase 5 — Todos juntos
| Paso | Qué | Estado |
|---|---|---|
| 5.1 | **Evaluación conjunta**: 15–30 tareas completas (repos pequeños con tests que fallan, investigación, docs, commits): éxito comprobado por tests ocultos, pass^3, **enrutamiento correcto** (¿delegó en el especialista esperado?), tokens totales, datos perdidos tras compactar; ablación que cambia cada especialista mejorado por su versión base para ver qué aportó cada cambio. | pendiente |

## Fase 6 — Documentación y skill del plugin
| Paso | Qué | Estado |
|---|---|---|
| 6.1 | **Documentación completa** del fork: arquitectura, agentes, herramientas, hooks, configuración, guía de usuario y de contribución, coherente con el código final. | pendiente |
| 6.2 | **Skill del plugin** creada con `skill-creator` (instalado en `~/.agents/skills/` y `~/.claude/skills/`): estructura del proyecto, cada parte modular, cómo modificar o añadir agentes, hooks, herramientas y reglas; probada con las evaluaciones de `skill-creator`. | pendiente |

## Aparcado (decidido no hacer por ahora)
- ~~Reglas de lenguaje/framework cargadas bajo demanda~~ — absorbido en 4.5 (antes 2.9), 29-09-2026.

## Registro de decisiones del roadmap
- 02-10-2026 — 0.8 aprobado en tres entregas (0.8a corte + vigilante + límites; 0.8b procesos obligatorios; 0.8c reanudación + SIGTERM + memoria); memoria 1,2 GB o 85 % de RAM; procesos 2 h y aviso.
- 02-10-2026 — 4.1: medición base del `explore` actual: acierto 98 % (pass^3 94 %), ~54k tokens por pregunta en el fork y 27k–40k en los otros repos; la mejora a buscar es de coste. Orden: se hacen antes 0.8 y 0.9 (protegen las mediciones con modelos gratuitos) y luego las herramientas de 4.1.
- 02-10-2026 — Cierres repentinos de OpenCode: causa encontrada (earlyoom mata al proceso más grande por falta de memoria). Añadido a la reanudación (0.8/0.9): guardar al recibir SIGTERM, vigilante de memoria con aviso e investigación de fugas.
- 02-10-2026 — Control del PC con IA (documento del usuario): navegador en 4.13, escritorio en 4.17 con el motor propio `senpi-desktop` (no MCP de terceros), OCR tesseract.js como respaldo aprobado; Windows: plugin nativo (0.11) y herramientas de desarrollo con Linux/WSL; descartado exigir WSL.
- 02-10-2026 — Añadido 0.10 (ver tareas en segundo plano): progreso en vivo, `/bg`, panel Jobs con clic y documentación de tmux/attach; después de 0.8 y 0.9.
- 02-10-2026 — Reintentos limitados y reanudación (común a 0.8/0.9, `plans/bounded-retry-resume.md`): presupuesto aprobado (proveedor 5+1+1, cuelgues 2, bucles 2/3/4, tope 6 por tarea, modelo apartado tras 5 fallos en 10 min); al parar: trabajo `paused`, tarjeta `.omo/runs/<id>/RESUME.md`, cambios en `refs/omo/wip/<id>` (sin commits), aviso con opciones y `/omo-resume`.
- 02-10-2026 — Requisito común de 0.8 y 0.9: nada se reintenta para siempre; tras unos pocos intentos se avisa al usuario y se puede reanudar sin pérdidas (en investigación).
- 02-10-2026 — Añadido 0.9 (integridad de tests, rompe-bucles con búsqueda y pregunta al usuario, errores de tipos), en código; no es un agente nuevo: lo vigila el plugin y mejoran test-writer, debugger y test-reviewer.
- 02-10-2026 — 0.8: A + B; procesos largos en segundo plano con aviso adelantados desde 4.14; las herramientas del fork que sustituyen prácticas peligrosas son **obligatorias** (bloqueo por código de la alternativa + regla explícita en el prompt), no opcionales.
- 02-10-2026 — Añadido 0.8 (cuelgues silenciosos del modelo): investigar formas eficientes de detectarlo y de mostrárselo al modelo, y presentar variantes antes de diseñar.
- 02-10-2026 — Fase 5: la prueba final se hace sobre el proyecto real `codegenerator` (Python, hexagonal, plugins), con prompts de funcionalidad ejecutados por OpenCode + este plugin; cubre todos los agentes y funciones del fork.
- 01-10-2026 — 4.1: motor de símbolos ast-grep (ya descargado por el plugin) + LSP, sin dependencias nuevas, detrás de una interfaz para poder cambiarlo; 3 herramientas en vez de 4–6 (menos herramientas = menos errores en modelos pequeños); repos de prueba: fork + ts-service + 2 públicos (Python, Go).
- 01-10-2026 — 3.0 hecho. Siguiente: 4.1 `explore` (tareas 15–30 con conjunto reservado, lectura eficiente de código).
- 01-10-2026 — 0.7 hecho. Descartado filtrar la cadena de reintentos de la delegación (rompía modelos con variante y no aporta con el modelo inicial ya válido). El banco (3.0) calienta la caché del plugin antes de las tareas.
- 01-10-2026 — 0.7 añadido y priorizado antes del piloto de 3.0: el piloto mostró que 4 modelos gratuitos configurados (`deepseek-v4-flash-free`, `mimo-v2.5-free`, `north-mini-code-free`, `laguna-s-2.1-free`) están `deprecated` y OpenCode los borra; `explore` y `librarian` no pueden ejecutarse. El usuario cambia los modelos con `/omo-models`; el plugin se protege con 0.7.
- 01-10-2026 — Planes visuales en 4.16: diagramas como código, porque los modelos sin visión leen y escriben su fuente; validados por código; skill `visual-plan` y HTML con `plan_render`. UI fiel al código en 4.13: diseño desde la app real con mapa de ids y comparación por código; skill común para cualquier herramienta de diseño, no un agente de Pencil.
- 01-10-2026 — 3.0: motor **propio en Bun** en vez de promptfoo (el sandbox, la ejecución como subagente, los correctores y la clasificación de fallos se escriben igual; promptfoo solo aportaba un visor a cambio de 32 MB de dependencias y una caché que hay que desactivar). Inspect AI queda como opción para la Fase 5. Modelos: los configurados con `/omo-models`, cualquier proveedor.
- 01-10-2026 — 0.6 hecho: `doctor` fiable para el fork. Hallazgos: los 5 fallos de comment-checker son contaminación entre archivos de test (pasan uno a uno), no un fallo del hook; la auditoría de `mock.module` puede agotar su tiempo bajo carga.
- 01-10-2026 — 0.6 redefinido tras analizar `doctor`: su consejo de actualizar desde npm reemplazaría el fork.
- 01-10-2026 — 0.5 hecho: las elecciones automáticas prefieren modelos gratuitos; lo elegido por el usuario manda.
- 01-10-2026 — 0.4 hecho: Prometheus no puede escribir fuera de `.omo/*.md` por ninguna vía conocida (falla cerrado).
- 01-10-2026 — 0.5: preferir modelos gratuitos en la elección automática, sin imponerlo: el modelo elegido en
  `/omo-models` siempre manda.
- 01-10-2026 — Control de versiones: `git-committer` se amplía a especialista de commits, ramas y merge (push/rebase solo
  con aprobación), con reglas generales + política por proyecto; la identidad nunca es la global: se pregunta por
  proyecto y se confirma en cada sesión antes del primer commit.
- 01-10-2026 — Reestructurado: banco de pruebas (Fase 3) antes de tocar agentes; un paso por especialista con plantilla
  común y orden por impacto (Fase 4), con los pasos transversales 2.3–2.11 dentro del agente al que pertenecen;
  evaluación conjunta (Fase 5); documentación y skill del plugin con `skill-creator` al final (Fase 6).
- 01-10-2026 — Reglas: creación **interactiva** cuando el proyecto no tiene (≤7 propuestas con evidencia, una sola
  pregunta; sin interfaz quedan como propuestas); "obligatorio" **por código** (inyección por ruta a quien edita,
  planea o commitea) + `rules-checker` antes del verifier y de cada commit; si una regla impide algo pedido o viable,
  se pregunta antes con 4 opciones.
- 27-09-2026 — Código dentro del plugin; decisiones versionadas en `docs/decisions/`; "hecho" exige evidencia
  (`block`); indexar sesiones: sí; todo activado por defecto.
- 27-09-2026 — No elegir entre tus agentes y los del plugin: quedarse con el mejor de cada papel (paso 2.1).
- 27-09-2026 — Añadido 1.6: la compactación no debe perder peticiones, restricciones, decisiones ni pendientes.
- 01-10-2026 — 0.3 hecho: ningún agente desaparece por su modelo; aviso al arrancar.
- 29-09-2026 — Investigados los hallazgos de la QA de 2.2 y dos problemas nuevos del usuario: añadidos 0.3, 0.4, 2.10 y 2.11; ampliados 2.4 y 2.6; corregido que `knowledge_open` mostraba secretos.
- 29-09-2026 — 2.2 hecho; QA real (corregida: la prueba del `verifier` con `opencode run --agent` caía a Sisyphus; los especialistas se prueban por delegación): el formato de salida de los especialistas necesita comprobación por código (2.6) y queda para 2.4 decidir si el orquestador puede hacer lecturas pequeñas sin delegar.
- 29-09-2026 — Misión del fork fijada; añadido 2.9 (absorber la biblioteca con criterio "solo lo mejor"); `@planning`/`@running` y los 4 revisores del usuario se archivan: sus reglas útiles ya están absorbidas o planificadas, el resto se descarta.
- 29-09-2026 — Añadidos 2.7 (guardián de reglas) y 2.8 (lectura de código eficiente), con investigación por especialista.
- 29-09-2026 — 2.1 hecho: matriz de enrutamiento y arquitectura objetivo (orquestadores + especialistas).
- 29-09-2026 — 0.2 hecho: borrar equipos colgados desde otra ejecución (herramienta + CLI).
- 28-09-2026 — 1.6 hecho: sin mejora medible de recuerdo en el banco (ambos 10/10), pero con citas exactas de cada mensaje del
  usuario; el usuario eligió integrarlo activado.
- 28-09-2026 — Decisiones: se mantiene un `.md` por decisión (estándar ADR); el plan pasa a enlaces generados; se añaden vistas,
  validación y la inyección de decisiones al tocar archivos (1.4b, 1.4c). Registro: `docs/decisions/`.
