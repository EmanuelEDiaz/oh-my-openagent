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

## Reglas transversales del usuario (se aplican a todos los pasos)
1. **Sin pendientes:** ningún paso se cierra con cosas a medias; se terminan o se pregunta.
2. **Cada elección del usuario va al plan y al roadmap**; lo descartado queda con su motivo.
3. **Criticar las ideas antes de integrarlas:** qué está bien, dónde falla y por qué, versión mejorada; o "medir
   primero".
4. **Medir la eficacia de todo** (no basta con que funcione): cada paso tiene su medición en el banco y se reporta, **incluido el consumo de contexto por agente y tarea** (0.13).
5. **Integración del sistema entero:** la QA de cada paso prueba cómo convive con lo ya hecho; 5.2 hace la matriz
   completa.
6. **Arquitectura:** solo los agentes de tab orquestan; los de "@" son atómicos y nunca delegan; cada "@" tiene su
   paso; **para cualquier tarea el orquestador trabaja con un especialista**.
7. **Agentes que faltan:** si una tarea no tiene especialista adecuado, se le dice al usuario, se investiga si conviene
   y nunca se crea sin su aprobación.
8. **Adversarios:** el agente los recomienda explicando por qué; **decide siempre el usuario**.
9. **Windows y Linux:** el plugin funciona en los dos; las herramientas de desarrollo pueden pedir Linux/WSL.
10. **Herramientas obligatorias** (como `process_start`): el agente sabe que no son opcionales.
11. **Pruebas reales:** QA en OpenCode aislado (nunca la base de datos real del usuario), se limpian sesiones y procesos
    de prueba; la evaluación final, con prompts sobre una copia de `codegenerator`, nunca con código escrito a mano.
12. **Nombres:** el plugin y los agentes se renombrarán (paso 5.0) para que se reconozca qué hace cada uno.

## Orden de trabajo (actualizado 03-10-2026)
1. **4.18 `@web-researcher`** — implementado y con QA; **su medición espera a que Zen funcione en el banco** (04-10-2026: Zen rechaza el plan gratuito desde el entorno aislado con "free tier can only be used from within OpenCode"; `deepseek-v4-flash-free` no disponible, `north-mini-code-free` y `laguna-s-2.1-free` retirados). El usuario eligió esperar a Zen en vez de medir con OpenRouter/Groq.
2. **Medición de 0.9a** (regla 4): guardián de tests y errores de tipos, con y sin, en modelos gratuitos.
3. **0.9b** — freno de bucles, búsqueda (usa `@web-researcher`) y tope de 6 por tarea.
3b. **0.13 presupuesto de contexto** (prioridad del usuario): medir el desglose y recortar sin perder eficacia (comprobado en el banco).
4. **0.10** (ver tareas en segundo plano, hablar con subagentes, mensajes a mitad de tarea), **0.11** (Windows nativo) y **0.12** (MCP bajo demanda, si la medición con modelos lo confirma).
5. **4.1** herramientas de `explore`, y el resto de la Fase 4 uno a uno (4.2a … 4.17), con los adversarios 4.21–4.23.
6. **4.20** encargo de delegación y skills (medir primero) → **4.19** uso obligatorio por agente de tab.
7. **5.0** renombrado → **5.1** evaluación conjunta → **5.2** integración del sistema entero.
8. **Fase 6:** documentación y skill del plugin, ya con los nombres nuevos.
9. **Fase 7:** laboratorio visual de agentes (última fase).

---

## Notas de QA (para no repetir errores)
- **Zen gratis exige `bash` y `read` en la petición (04-10-2026):** sin ellas, 403 "free tier can only be used from within OpenCode". Para investigar un rechazo, capturar la petición real con el proxy de contexto y reenviarla **con el `fetch` de Bun** (desde Python o curl Zen rechaza incluso peticiones válidas). Las capturas llevan la clave del usuario: borrarlas al terminar.
- **Nunca un modelo de pago por omisión (04-10-2026):** una sonda que reescribía `omo.jsonc` dejó la sesión padre sin modelo y OpenCode usó `claude-opus-5-5` de Zen con la clave del usuario. El entorno aislado fija ahora `model` y `small_model` a un modelo gratis (`OMO_BENCH_DEFAULT_MODEL`).
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
| 0.8 | **Cuelgues silenciosos del modelo** (pedido 02-10-2026, hallado en el banco de 3.0/4.1): a veces un modelo gratuito deja de emitir a mitad, sin error; OpenCode espera indefinidamente y, al abortar, el servidor llegó a dejar de responder. El banco ya lo detecta (240 s sin avance) y reinicia el servidor, pero en el uso real nadie lo corta ni avisa. Objetivo: detectarlo en el plugin, avisar (al usuario y al modelo/orquestador) y reintentar con el siguiente modelo de respaldo. Decidido (02-10-2026): A `chunkTimeout` 90 s por defecto + B vigilante a los 4 min sin tokens ni herramienta/proceso en marcha (avisa, informa al modelo, reintenta con respaldo); **procesos largos en segundo plano con `wait_for` y aviso, obligatorios y bloqueados por código en `bash`** (adelantado desde 4.14). | **0.8a hecho** (02-10-2026): `chunkTimeout` 90 s, vigilante a 4 min, reintento con el siguiente modelo en síncrona, segundo plano y sesión principal, máx. 2 por tarea; QA con proveedor simulado. **0.8b hecho**: `process_*` obligatorios para procesos largos, aviso al terminar, guarda en `bash`, regla en el prompt. **0.8c hecho** (03-10-2026): tarjetas de reanudación + `refs/omo/wip`, guardado al cerrar (SIGTERM/earlyoom), vigilante de memoria, `resume_task`/`/omo-resume` y "reanuda" sin comando; `/stop-continuation` pausa; sesiones del plan conservadas, `handoff_save`, avisos cuando Atlas o las tareas se rinden; memoria medida (sin fugas por mensaje; ~70 MB fijos por instancia) — `plans/stall-processes-resume.md`, `plans/robustness-fixes.md`, `plans/bounded-retry-resume.md` |
| 0.9 | **Integridad de tests, rompe-bucles y errores de tipos** (pedido 02-10-2026): por código, no solo prompts. Tests existentes de solo lectura durante un arreglo y revisión del diff (skip, aserciones debilitadas, mocks del módulo, `any`/`ts-ignore`); test nuevo válido solo si falla antes y pasa después; rompe-bucles con huella de error (2 aviso / 3 empezar de cero + búsqueda en Stack Exchange, issues de GitHub, Exa y SearXNG opcional / 4 bloquear y preguntar al usuario con opciones); diagnósticos de tipos nuevos tras cada edición. Especialista nuevo `web-researcher` para búsquedas web (con `web_search`: Stack Exchange, GitHub, SearXNG). Tope de 6 por tarea. Mejoras de agentes en 4.7, 4.8 y 4.11. Entregas 0.9a (tests y tipos) → 4.18 → 0.9b (bucles, búsqueda, tope). | **0.9a hecho** (tests protegidos, desbloqueo solo con la respuesta del usuario, tests nuevos juzgados por fallar antes y pasar después, errores de tipos nuevos desde el LSP del plugin, sintaxis rota deshecha); siguiente 4.18 y luego 0.9b — `plans/test-integrity-and-loops.md`, `plans/bounded-retry-resume.md` |
| 0.10 | **Ver las tareas en segundo plano** (pedido 02-10-2026): (1) marcar la tarea delegada como `background` para que la llamada muestre progreso y última acción en vivo; (2) `/bg` + `ctrl+x b` con la lista de tareas en marcha y Enter para entrar en su sesión; (3) panel lateral "Jobs" con clic que abre la sesión y línea de acción actual; (4/5) documentar tmux (`tmux.enabled`, OpenCode con `--port`) y `opencode attach -s` desde otra terminal. Hoy ya funciona `ctrl+x ↓` / `→` / `ctrl+x ↑` para entrar en las sesiones hijas. **Hablar con subagentes en marcha** (decidido 02-10-2026, opción A + C): `agent_message({task_id, text})` escribe en la sesión del subagente (guardado en el historial, con su agente y modelo explícitos para que OpenCode no lo cambie al agente por defecto) y lo ve en su siguiente paso; `reply_to_parent` contesta por el aviso al padre; `/msg <tarea> <texto>` para el usuario; ids de mensaje, límite por tarea y "entregado sin respuesta" si el modelo no contesta; si llega al terminar, se reanuda para que conteste. **Mensajes a mitad de tarea sin perder el hilo** (decidido 02-10-2026, a + c): el plugin envuelve el mensaje que llega mientras trabaja con un aviso corto (tarea en curso, paso, cómo tratar el mensaje: aparte → responde y sigue; corrección → aplícala; cambio solo si se pide), nunca para "para / olvida / en vez de"; deja de apagarse la reanudación de pendientes tras un mensaje del usuario; tarjeta de reanudación solo si cambia de agente o modelo; "reanuda" sin comando vuelve a la tarea interrumpida. | decidido — tras 0.8 y 0.9 |
| 0.11 | **Windows nativo** (decidido 02-10-2026): el plugin funciona en Windows y Linux; regla para todo lo nuevo (sin `sh -c`/`grep`/`tar`/`kill(-pid)`, utilidades del repo para procesos y rutas) y corrección de lo del plugin que no sea multiplataforma (p. ej. patrones `command -v`/`which` de los especialistas); pruebas en el CI de Windows. Las herramientas de desarrollo (banco) pueden exigir Linux/WSL/Git Bash. | decidido — `plans/computer-use.md` |
| 0.12 | **MCP bajo demanda y por especialista** (idea del usuario, 04-10-2026; **medido antes de decidir**) | cada especialista declara sus MCP en su contrato; el código solo le muestra esos; los orquestadores no ven MCP (delegan); un MCP local arranca la primera vez que un agente autorizado lo usa (reutilizando el mecanismo `skill_mcp`); petición excepcional con motivo, aprobada por el orquestador o el usuario. **Medición (04-10-2026, entorno aislado):** con los MCP del usuario + los del plugin, cada ventana de OpenCode ocupa **1026 MB frente a 580 MB sin ellos (+446 MB)**, y cada petición de Sisyphus lleva **77 herramientas frente a 31: 43 de MCP, unos 9.800 tokens extra por petición**. En OpenCode real, un "hola" ya ocupa 78.801 tokens (39 % del contexto). **Mejorar el uso de cada MCP** (usuario, 04-10-2026): descripciones de sus herramientas más cortas y claras, guía por especialista (cuándo usarlo + ejemplo de llamada), recorte o resumen de salidas grandes (afinando el recortador de salidas por MCP), reintentos, caché y errores entendibles cuando un MCP falla. Falta medir con modelos reales el acierto al elegir herramienta, las llamadas correctas y los tokens (cuando Zen funcione en el banco). Riesgos: el login OAuth de `supabase` y Windows | pendiente — se hace si la medición con modelos lo confirma; evidencia `.omo/evidence/lazy-mcp/` |
| 0.13 | **Presupuesto de contexto** (prioridad pedida por el usuario, 04-10-2026) | un "hola" a Sisyphus en OpenCode real ocupa 78.801 tokens (39 % del contexto): dividir en tareas debería reducir lo que procesa el modelo, no inflarlo. (1) **Medir** el desglose de cada petición por agente (prompt del agente, reglas cargadas por `instructions`, guías del plugin, definiciones de herramientas, MCP, lista de skills/agentes); (2) recortar lo que no aporta (cargar reglas y guías solo cuando aplican, prompts de tab más cortos, herramientas y MCP solo para quien las usa — enlaza con 0.12, descripciones más cortas); **el desglose se mide en todas las pruebas del banco** (usuario, 04-10-2026): un registrador de contexto (proxy local que reenvía las peticiones al proveedor sin cambiarlas) guarda por petición el peso de cada parte, y cada informe del banco trae una tabla por agente y tarea (tokens por petición, parte que más pesa, crecimiento a lo largo de la tarea); (3) **condición del usuario: no perder eficacia** — cada recorte se compara en el banco antes y después (acierto, pass^k, tokens) y solo se queda si la eficacia se mantiene | pendiente — prioridad tras 0.9b |

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
| 4.2a | `librarian` | documentación de librerías y código de repos abiertos (antes 2.3): docs oficiales primero, citas literales verificadas, versión instalada; la web abierta pasa a `@web-researcher` | pendiente |
| 4.2b | `api-lookup` | documentación de APIs: versión exacta, firmas y ejemplos verificados | pendiente |
| 4.3 | `memory` | calidad del recuerdo de decisiones y chats; ocultación de secretos en el índice | pendiente |
| 4.4 | `verifier` | contrato `<report>` comprobado en ejecución (resto de 2.6), estado `FLAKY`, comparación con la base; **desafío de afirmaciones** (adversario; lo recomienda el agente, decide el usuario): cada "hecho"/"arreglado" se reproduce con un comando o se rechaza — `plans/adversaries.md` | pendiente |
| 4.5 | `rules-checker` + guardián de reglas | antes 2.7 + **creación interactiva de reglas** + absorción de la biblioteca (antes 2.9) y reglas por stack | pendiente — `plans/rules-guardian.md` |
| 4.6 | `security-reviewer` | credenciales y guarda de destrucción (antes 2.11), escáneres gratuitos | pendiente — `plans/credentials.md` |
| 4.7 | `test-writer` | test en rojo por la razón correcta, valores esperados desde la especificación | pendiente |
| 4.8 | `debugger` | reproducción, `git bisect run`, bucle hipótesis/experimento | pendiente |
| 4.9 | `git-committer` → **especialista de control de versiones** | commits + ramas + merge, push/rebase solo con aprobación; reglas generales + política por proyecto; **identidad del proyecto preguntada y confirmada en cada sesión, nunca la global** (ordenador compartido); comprobado por código | pendiente — `plans/version-control.md` |
| 4.10 | `dependency-check` | registro + OSV + deps.dev, señales de "slopsquatting" | pendiente |
| 4.11a | `test-reviewer` | precisión/recall con diffs con fallos sembrados en tests | pendiente |
| 4.11b | `lang-reviewer` | precisión/recall con diffs con fallos sembrados de cada lenguaje | pendiente |
| 4.11c | `architect-reviewer` | precisión/recall con diffs con fallos sembrados de arquitectura | pendiente |
| 4.12 | `docs-writer` | afirmaciones que apuntan al código, Diátaxis, CHANGELOG | pendiente |
| 4.13 | `ui-tester` | instantáneas de accesibilidad, consola, capturas solo si hacen falta; **navegador seguro** (Playwright MCP `--isolated`, `ui-tester` con cualquier proveedor, capa de seguridad de `plans/computer-use.md`); **UI fiel al código**: capturar la app real, mapa de ids ruta→componente→`archivo:línea`→nodo del diseño, comparación por código (sirve sin visión); skill "diseño desde la UI real" para Pencil, Figma o HTML | pendiente — `plans/ui-fidelity.md` |
| 4.14a–h | Implementadores, un paso por categoría: `visual-engineering`, `ultrabrain`, `deep`, `quick`, `artistry`, `writing`, `unspecified-high`, `unspecified-low` | skills obligatorias de cada categoría (antes 2.5); los procesos gestionados (antes 2.10) pasan a 0.8 | pendiente — `plans/process-lifecycle.md` |
| 4.15a | `multimodal-looker` | — | pendiente |
| 4.15b | `metis` | — | pendiente |
| 4.15c | `momus` | — | pendiente |
| 4.15d | `oracle` | — | pendiente |
| 4.16 | Orquestadores (agentes de tab): Prometheus, Atlas, Sisyphus, Hephaestus | enrutamiento obligatorio por código y presupuesto de lectura (antes 2.4); calidad de plan, ejecución y delegación; **planes visuales**: Mermaid/SVG como código con `archivo:línea`, validados por código, skill `visual-plan` y herramienta `plan_render` (HTML) | pendiente — `plans/visual-plans.md` |
| 4.17 | **Control del escritorio con IA** (decidido 02-10-2026): llevar a OpenCode el motor propio `senpi-desktop` (Rust; Windows UIA, Linux X11/Wayland/AT-SPI) con una herramienta `computer` basada en árbol de texto y referencias (sirve para modelos sin visión); aislamiento por defecto (Xephyr en Linux, usuario aparte o Windows Sandbox en Windows); capa de control y seguridad (parada y pausa, listas permitidas, aprobación de acciones irreversibles, texto de pantalla como datos, auditoría); ≤ 6 herramientas, comprobación tras cada acción, 15–25 pasos y reanudación; respaldos OCR (tesseract.js) y visión puntual con modelo gratuito. | pendiente — `plans/computer-use.md` |
| 4.18 | **`web-researcher`** (nuevo, decidido 03-10-2026) | búsquedas en la web abierta: estudio de lo mejor para él, diseño con el usuario, herramienta `web_search` (Stack Exchange, issues de GitHub, SearXNG), enlaces comprobados por código, presupuesto por llamada, medición en el banco. **Se hace entre 0.9a y 0.9b**, porque el freno de bucles lo usa. Diseño aprobado: 3 herramientas (`web_search` por tipo de pregunta, `web_read` local con Jina de respaldo, `registry_lookup`), bucle controlado por código, citas comprobadas, protección frente a instrucciones escondidas, claves gratuitas opcionales | en curso — `plans/web-researcher.md` |
| 4.21 | **`@breaker`** (adversario; lo recomienda el agente explicando por qué, decide el usuario) | ataca un arreglo con ≤3 tests o scripts que deben ejecutarse y fallar (2–3 repeticiones); sin prueba ejecutable se descarta; tests protegidos por 0.9a y uno oculto como control | pendiente — `plans/adversaries.md` |
| 4.22 | **`@mutant`** (adversario; lo recomienda el agente explicando por qué, decide el usuario) | 3–5 fallos pequeños en las líneas cambiadas; informa de los que ningún test detecta; todo decidido y deshecho por código | pendiente — `plans/adversaries.md` |
| 4.23 | **`@plan-attacker`** (adversario; lo recomienda el agente explicando por qué, decide el usuario) | pre-mortem de los planes de Prometheus: ≤5 causas con citas comprobadas por código; Prometheus resuelve, rechaza con motivo o pregunta; una ronda | pendiente — `plans/adversaries.md` |
| 4.20 | **Encargo de delegación y skills** (ideas del usuario, 03-10-2026: un "ingeniero de prompts" entre orquestador y especialista que mejore el encargo y pida skills; **se mide antes de decidir**; se hace antes de 4.19) | comparar en el banco, con los mismos encargos y modelos gratuitos: (a) encargo tal cual; (b) encargo estructurado validado por código (objetivo, petición literal del usuario adjuntada por el plugin, contexto con ubicaciones, restricciones, formato, criterio de terminado) + skills sugeridas por código; (c) encargo reescrito por un modelo (agente `@prompt-engineer` o ampliando `@metis`). Riesgos a medir en (c): desvío de lo pedido, pérdida de las palabras del usuario, coste y fallos por delegación extra. Instalar skills externas siempre pregunta al usuario. Con los resultados se decide con el usuario. **Skills** (usuario, 03-10-2026, opción recomendada): (1) medir cuánto obedecen los modelos gratuitos una skill con reglas comprobables, con y sin skill, y cuánto daño hace una skill que no corresponde; (2) por código, al cargar una skill, detectar choques con los permisos del agente y las reglas del plugin (caso real: la skill `debugging` pide editar y delegar al `@debugger`, que no puede), decir al agente qué partes ignorar y avisar al usuario. Los avisos cuando una skill causa problemas y el historial por skill solo se construyen si la medición muestra que hacen falta | pendiente |
| 4.19 | **Uso obligatorio por agente de tab** (decidido 03-10-2026; último paso de la Fase 4) | tabla de qué agentes de "@" debe usar cada agente de tab y en qué momento (por ejemplo: Prometheus usa `@explore` antes de planear y `@momus` antes de dar el plan por bueno; Atlas usa `@verifier` antes de marcar una tarea y `@git-committer` para los commits; Sisyphus usa `@web-researcher` para información externa o actual), obligada por código como `process_start` y basada en lo medido en cada paso. **Regla del usuario (03-10-2026): para cualquier tarea, el orquestador trabaja siempre con un agente especializado**; las tareas mínimas van a un implementador especializado (p. ej. la categoría `quick`, 4.14) y el banco mide el coste en tareas mínimas; si sale caro, se decide con el usuario con datos | pendiente |

**Equivalencias con la numeración anterior:** 2.3→4.2 · 2.4→4.16 · 2.5→4.14 · 2.6→3.0 + 4.4 · 2.7→4.5 · 2.8→4.1 ·
2.9→4.5 · 2.10→4.14 · 2.11→4.6 · 3.1→5.1.

## Fase 5 — Todos juntos
| Paso | Qué | Estado |
|---|---|---|
| 5.0 | **Renombrado** (decidido por el usuario, 03-10-2026: el plugin es suyo) | nombre nuevo del plugin y de los agentes de tab y de "@", elegidos con el usuario para que se reconozca qué tarea hace cada uno; se propone una lista y él decide; los nombres antiguos siguen funcionando en la configuración (migración automática); se actualizan prompts, tests, documentación y el banco. Se hace antes de la evaluación final y de la documentación para que ambas usen los nombres definitivos | pendiente |
| 5.1 | **Evaluación conjunta**: 15–30 tareas completas (repos pequeños con tests que fallan, investigación, docs, commits): éxito comprobado por tests ocultos, pass^3, **enrutamiento correcto** (¿delegó en el especialista esperado?), tokens totales, datos perdidos tras compactar; ablación que cambia cada especialista mejorado por su versión base para ver qué aportó cada cambio. | pendiente |
| 5.2 | **Integración del sistema entero** (pedido del usuario, 03-10-2026) | matriz de integración: cada parte probada junto con las demás (guardián de tests + freno de bucles + reanudación + adversarios + `@web-researcher` + cuelgues y procesos), con modelos gratuitos y escenarios de fallo combinados; además, la QA de cada paso incluye cómo convive con lo ya hecho | pendiente |

## Fase 6 — Documentación y skill del plugin
| Paso | Qué | Estado |
|---|---|---|
| 6.1 | **Documentación completa** del fork: arquitectura, agentes, herramientas, hooks, configuración, guía de usuario y de contribución, coherente con el código final. | pendiente |
| 6.2 | **Skill del plugin** creada con `skill-creator` (instalado en `~/.agents/skills/` y `~/.claude/skills/`): estructura del proyecto, cada parte modular, cómo modificar o añadir agentes, hooks, herramientas y reglas; probada con las evaluaciones de `skill-creator`. | pendiente |

## Fase 7 — Laboratorio visual de agentes (última fase)
| Paso | Qué | Estado |
|---|---|---|
| 7.1 | **Laboratorio visual** (petición del usuario, 04-10-2026): modo visual del panel "Jobs" de 0.10 en la barra lateral; cada agente un personaje en su puesto y el orquestador el jefe; clic → bocadillo con qué hace (herramienta, tarea, modelo, tiempo, tokens); solo eventos de OpenCode, dibujado con medios bloques, casi nulo plegado, 2–4 fps solo con agentes trabajando; assets CC0 MurphysDad Robot Lab (+ Sci-Fi Facility). Maqueta HTML hecha (https://claude.ai/artifact/WcChKoF5BysxboKW8KzcLw); **el usuario quiere verla también en Pencil** (cuando el MCP de Pencil conecte: hoy falla porque la ruta de la AppImage cambia en cada arranque) antes de construir | pendiente — `plans/agent-lab.md` |

## Aparcado (decidido no hacer por ahora)
- ~~Reglas de lenguaje/framework cargadas bajo demanda~~ — absorbido en 4.5 (antes 2.9), 29-09-2026.

## Registro de decisiones del roadmap
- 04-10-2026 — Hecho (petición del usuario): el panel lateral deja de sondear. Antes releía el estado cada segundo revalidando toda la configuración y el servidor lo reescribía cada 2 s aunque no pasara nada; ahora configuración y agentes se calculan una vez, el panel se refresca cuando cambia el archivo de estado (vigilancia del sistema de ficheros; eventos de OpenCode como respaldo) y el latido del servidor solo corre con trabajo en curso.
- 04-10-2026 — Laboratorio visual de agentes como última fase (Fase 7), modo visual del panel Jobs de 0.10; maqueta HTML primero. Encontrado en la investigación: el panel lateral actual sondea un archivo cada segundo y revalida la configuración en cada sondeo; el usuario pide arreglarlo ya (pasa a funcionar por eventos).
- 04-10-2026 — Causa del fallo de Zen encontrada y comprobada reenviando peticiones capturadas: el plan gratuito exige que la lista de herramientas incluya `bash` y `read` (regla no documentada; issues anomalyco/opencode #51241, #50627, #51315 sin respuesta de mantenedores). Afectaba a los agentes que las ocultan (`@web-researcher`, `@api-lookup`, `@memory`, `@dependency-check`, `@ui-tester`, Prometheus). Decisión del usuario (opción A): con un modelo gratis de Zen, esas dos herramientas quedan visibles pero con todo uso denegado por permiso (+~1.770 tokens solo en esos agentes); `zen_free_gate: false` lo desactiva. Descartados usar otros proveedores para esos agentes y esperar a OpenCode.
- 04-10-2026 — Prioridad del usuario: reducir el contexto por petición (78.801 tokens para un "hola") sin perder eficacia; paso 0.13 justo después de 0.9b, con medición antes y después en el banco.
- 04-10-2026 — MCP bajo demanda (idea del usuario, "pruébalo primero"): medido en el entorno aislado: +446 MB por ventana y ~9.800 tokens por petición con los MCP actuales. Queda medir el acierto al elegir herramienta con modelos reales; si se confirma, se hace como 0.12 antes de la Fase 4.
- 04-10-2026 — Zen cambió: el plan gratuito falla desde el entorno aislado del banco y varios modelos de la configuración del usuario ya no existen. El usuario prefiere esperar a resolver Zen para medir 4.18 (descartado medir ya con OpenRouter/Groq). Mientras, se avanza 0.9b.
- 03-10-2026 — El usuario renombrará el plugin y los agentes (paso 5.0, antes de la evaluación final y la documentación). Se añaden al roadmap las "Reglas transversales del usuario" y el "Orden de trabajo" para tener todo lo pedido en un solo sitio.
- 03-10-2026 — Reglas del usuario: (1) si falta un agente especializado para una tarea, se le dice y se investiga si conviene añadirlo (nunca se crea sin su aprobación); (2) para cualquier tarea el orquestador trabaja siempre con un especialista (4.19; lo mínimo, con un implementador especializado; se mide el coste); (3) integración del sistema entero: la QA de cada paso prueba la convivencia con lo anterior y 5.2 hace una matriz de integración.
- 03-10-2026 — Regla general del usuario: **medir la eficacia de todo lo que se hace en el fork** (cada paso define cómo se mide en el banco y se reporta el resultado).
- 03-10-2026 — Sistema de adversarios (petición del usuario): `@breaker` (4.21), `@mutant` (4.22), `@plan-attacker` (4.23) y desafío de afirmaciones en `@verifier` (4.4); evidencia ejecutable, decide el código, topes de rondas. **El agente los recomienda explicando por qué y el usuario decide siempre** (obligado por código); se mide su eficacia y la precisión de las recomendaciones. Descartados el debate libre, la revisión de opinión sin ejecución, el modelo juez y los juegos de personajes. Van antes de 4.20 y 4.19.
- 03-10-2026 — Skills (preocupación del usuario: cuánto las obedece un modelo y avisar si no encajan o causan problemas): en 4.20 se mide la obediencia y el daño de una skill equivocada, y se detectan por código los choques con permisos y reglas, avisando al usuario. Avisos por problemas e historial, solo si los datos lo justifican.
- 03-10-2026 — Idea del usuario: "ingeniero de prompts" que mejore los encargos de los orquestadores y busque skills. Crítica: teléfono descompuesto, le falta el contexto del orquestador, coste y fallos en cada delegación, solapa con `@metis`, instalar skills externas es un riesgo. Alternativa propuesta: encargo estructurado por código + skills sugeridas + reescritor solo cuando haga falta. El usuario elige **medir primero**: paso 4.20 (antes de 4.19) compara las tres variantes en el banco.
- 03-10-2026 — 4.18 `web-researcher`: diseño aprobado; sin claves con claves gratuitas opcionales (Tavily, Jina, Stack Exchange); lectura local con Jina solo de respaldo; DuckDuckGo descartado (robots.txt).
- 03-10-2026 — 0.9a: el LSP de OpenCode está apagado sin la clave `lsp`; los errores de tipos salen del daemon LSP compartido del plugin (usuario: opción recomendada) y se instalan `typescript-language-server`, TypeScript 5 y `pyright`. Descartado encender el LSP de OpenCode (un servidor por carpeta abierta).
- 03-10-2026 — Arquitectura de agentes (usuario): solo los agentes de tab (Sisyphus, Hephaestus, Atlas, Prometheus) orquestan; los de "@" son atómicos y nunca delegan (ya era así en el código). Descartado permitir "@ → @" (coste y fallos encadenados con modelos gratis). Cada agente de "@" tiene su propio paso en la Fase 4: se separan 4.2, 4.11, 4.14 y 4.15, y se añade 4.18 `web-researcher`, que se hace entre 0.9a y 0.9b. Nuevo 4.19, último de la Fase 4: uso obligatorio de agentes de "@" por cada agente de tab, por código.
- 03-10-2026 — 0.9: diseño detallado aprobado; dos entregas (0.9a tests y tipos, 0.9b bucles, búsqueda y tope). Nuevo especialista `web-researcher` para búsquedas web (el usuario prefiere un agente dedicado al híbrido plugin → librarian). Desbloqueo de tests solo con la respuesta del usuario a `question`.
- 03-10-2026 — Regla del usuario: ningún paso se cierra con pendientes. Completados los 4 que quedaban en 0.8c. La caché de repos del banco sale del proyecto (rompía la auditoría de mocks).
- 03-10-2026 — 0.8c hecho. El guardado ante SIGTERM se integra en la limpieza ordenada del plugin (un manejador aparte no llegaba a ejecutarse).
- 02-10-2026 — Reanudar en lenguaje natural ("reanuda", "sigue con lo de antes") sin comando: línea en el prompt de sistema cuando hay trabajo pausado + detección de la intención en el mensaje (en 0.8c); tras una interrupción, vuelve a la tarea original (en 0.10, con la opción a + c).
- 02-10-2026 — 0.10 ampliado: hablar con subagentes en marcha (A + C) y, en investigación, que un mensaje del usuario a mitad de tarea no haga olvidar la tarea.
- 02-10-2026 — 0.8b hecho: procesos gestionados en módulo propio (no se amplía `monitor`: sin shell, mata por tiempo y no sirve en Windows).
- 02-10-2026 — 0.8a hecho. Corregidos además: el respaldo por agente con nombre visible (afectaba a `runtime-fallback` del original) y "SSE read timed out" como error reintentable. Descartado bajar los temporizadores antiguos a 10 min (cancelaría herramientas largas legítimas).
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
