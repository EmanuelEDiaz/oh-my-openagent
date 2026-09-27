# Mejoras propias — fork de oh-my-openagent

Fork: https://github.com/EmanuelEDiaz/oh-my-openagent
Upstream: https://github.com/code-yeongyu/oh-my-openagent (licencia SUL-1.0: solo uso personal/no comercial)

## Cómo añadir una mejora

Copia la plantilla, dale un ID (`M-001`, `M-002`, …) y actualiza el estado.
Estados: `idea` → `investigando` → `en progreso` → `hecho` / `descartado`.

```markdown
### M-XXX — Título corto

- **Estado:** idea
- **Problema:** qué falla o qué echas en falta hoy
- **Propuesta:** qué cambiarías
- **Archivos afectados:** rutas en `packages/` o `crates/`
- **Cómo verificar:** comando o prueba que demuestra que funciona
- **Notas:**
```

## Mejoras

Rutas relativas a `packages/`; `S/` = `packages/omo-opencode/src/`.

### M-001 — Selector interactivo de modelos por agente (cadena con fallback)

- **Estado:** hecho (CLI). Pendiente M-001b (TUI).
- **Uso:**
  ```bash
  oh-my-opencode config models            # interactivo: agentes -> buscar/marcar con Tab -> ordenar
  oh-my-opencode config models --check    # qué modelos configurados ya no existen (exit 1 si un agente no tiene ninguno)
  oh-my-opencode config models --agent explore --models opencode/deepseek-v4-flash,opencode/big-pickle --enable-runtime-fallback
  ```
  `--project` escribe en `.omo/omo.jsonc` del proyecto; `--allow-unavailable` fuerza modelos no listados.
- **Ranking e info por modelo:** antes de elegir, cada agente muestra su rol y un top 10 puntuado (0-100).
  La puntuación combina: razonamiento, contexto (escala log), costo (gratis = máx.), antigüedad, y un bonus
  si el modelo está en la cadena recomendada del plugin (`*`). Penaliza x0.3 si no tiene tool calling o si
  el agente necesita imagen y el modelo no la acepta. Pesos por agente en `S/cli/config-models/agent-profiles.ts`.
  Cada opción muestra `ctx · modalidades · reasoning · tools · costo · fecha`; al enfocarla, la descripción,
  fecha de conocimiento y avisos. Se puede filtrar escribiendo `img`, `pdf`, `free`, `1M`...
  `--rank <agente> [--top N] [--json]` imprime el ranking sin interacción.
  Los modelos de `disabled_providers` se excluyen.
- **Datos:** metadatos de `~/.cache/opencode/models.json` (models.dev). No incluye velocidad/latencia ni
  benchmarks: la puntuación es heurística, sirve para orientar, no como verdad absoluta.
- **Problema:** para cambiar el modelo de un agente hay que editar `~/.omo/omo.jsonc` a mano, sin saber qué
  modelos existen *ahora*. Si el modelo primario deja de existir (p. ej. un modelo `-free` retirado), el
  agente falla. Además `runtime_fallback` viene **desactivado** por defecto, así que la cadena
  `fallback_models` solo se usa al resolver el modelo al arrancar, no cuando falla en mitad de la sesión.
- **Lo que ya existe (no duplicar):**
  - Config ya soporta cadena ordenada `agents.<name>.models: [primario, ...fallbacks]`
    (`S/config/schema/agent-overrides.ts:8-11`); `S/config/validate.ts:98` la materializa y tiene
    prioridad sobre `model` + `fallback_models`.
  - Resolución al arrancar salta modelos no disponibles: `model-core/src/model-resolution-pipeline.ts:99`.
  - Fallback reactivo (429/5xx/`model_not_found`): `S/hooks/runtime-fallback/`, **off por defecto**.
  - Escritor de config seguro (backup + atómico): `omo-config-core/src/writer/writer.ts:122`.
  - `@clack/prompts` 1.8.1 (tiene `autocompleteMultiselect`, aún no usado en el repo).
- **Propuesta:** comando `oh-my-opencode config models`:
  1. Lista los modelos disponibles ahora (`opencode models`; fallback a caches).
  2. Muestra la cadena actual de cada agente marcando los modelos que **ya no existen**.
  3. Checkbox con búsqueda para elegir modelos, luego paso de ordenado (primario → fallbacks).
  4. Escribe `agents.<name>.models` (limpia `model`/`fallback_models`) y ofrece activar `runtime_fallback`.
  5. Modos no interactivos: `--check` (solo diagnóstico) y `--agent X --models a,b,c` (scriptable).
- **Archivos afectados:** `S/cli/config-models/*` (nuevo), `S/cli/cli-program.ts`.
- **Cómo verificar:** `bun test packages/omo-opencode/src/cli/config-models` + ejecución real en HOME aislado.
- **Siguiente paso (M-001b):** slash command `/omo-models` dentro de la TUI de OpenCode
  (patrón `S/features/btw-side/tui-picker.ts:135`) y que el hook `model-fallback`
  (`S/hooks/model-fallback/fallback-state-controller.ts:73-75`) lea la cadena del usuario antes que la
  hardcodeada.

### M-002 — Memoria indexada para OpenCode (hoy no existe)

- **Estado:** idea
- **Problema:** `memory-core` (memoria en git, con hechos y recall) **solo lo usa Senpi**; OpenCode no tiene
  memoria entre sesiones. Lo único es `session_search`, un escaneo de subcadenas sin ranking
  (`S/tools/session-manager/tools.ts:102-199`).
- **Propuesta:** exponer `memory-core` en OpenCode y cambiar la búsqueda “FTS-lite”
  (`memory-core/src/search/query.ts:141-167`, AND estricto: si falta un término, 0 resultados) por
  **SQLite FTS5 + BM25** (`bun:sqlite` ya viene en Bun), con índice incremental.
  Mismo índice para `session_search` (con puntuación en los resultados).
- **Cómo verificar:** benchmark de recall sobre un corpus de sesiones reales; tests de ranking.

### M-003 — Registro de decisiones citado (anti-alucinación)

- **Estado:** idea
- **Problema:** el “por qué” solo vive en `.omo/notepads/<plan>/decisions.md`, texto libre sin esquema ni
  citas (`S/hooks/ulw-execute/notepad-scaffold.ts:8-60`). Atlas ni siquiera lo lista al releer notepads
  (`S/hooks/atlas/verification-reminders.ts:88-101`). Los resultados de subagentes no llevan fuentes
  (`S/tools/delegate-task/sync-completion-message.ts:35-60`).
- **Propuesta:**
  1. Esquema de decisión: `id, fecha, decisión, por qué, alternativas, evidencia[]` donde evidencia es
     `commit | file:line | URL | sesión`. Herramientas `decision_record` / `decision_search`
     (indexadas con el mismo FTS5 de M-002).
  2. Hook de verificación: al marcar `- [x]` o declarar “done”, comprobar que las rutas de evidencia
     existen y que `file:line` citados siguen apuntando a código real (portar el gate de Codex
     `omo-codex/plugin/components/ulw-loop/src/spawn-guard.ts` y `lazycodex-executor-verify/`).
  3. Reporte de subagentes con campo `sources` obligatorio (ampliar `team-core` `MessageSchema.references`
     con `line`, `commit`, `url`).
  4. Añadir `decisions.md` a la lista de Atlas y proteger notepads también contra `edit`/`apply_patch`.

### M-004 — Worktrees reales y seguros

- **Estado:** idea
- **Problema:**
  - **Bug de pérdida de datos:** en team-mode el “worktree” es un `mkdir`
    (`S/features/team-mode/team-runtime/create.ts:76-80`) y al limpiar se hace `rm -rf` del path
    (`cleanup-team-run-resources.ts:66-68`). Si `worktreePath` apunta a un directorio existente, se borra.
    `team-core/src/team-worktree/manager.ts` tiene `git worktree add` real pero nadie lo llama.
  - En `ulw-execute` crear/limpiar el worktree lo hace el modelo por prompt, sin hook que lo garantice.
- **Propuesta:** usar `team-core` `createWorktree/removeWorktree` (con `git worktree prune`), rechazar
  paths existentes, y un hook que cree el worktree y verifique su limpieza en ulw-execute.

### M-005 — Optimización de contexto (tokens)

- **Estado:** idea
- **Hallazgos:**
  - AGENTS.md de directorios puede inyectar hasta 50k tokens por archivo (`agents-md-core/src/injector.ts:56`);
    Hephaestus probablemente duplica el AGENTS.md raíz (`skipRoot:false`) que OpenCode ya inyecta.
  - AGENTS.md/README no deduplican contra el transcript (rules sí) y se reinyectan tras cada compactación.
  - `read`, `bash`, `session_read`, resultados de `task` y MCPs (context7/websearch) no se truncan por
    defecto; el truncado es “cabeza + corte” con 4 chars/token.
  - La descripción del tool `skill` lista todas las skills en cada request.
  - El resumen de compactación no conserva anclas de fuente (`file:line`).
- **Propuesta:** presupuesto por inyección + resumen por secciones; dedupe por hash en el transcript;
  truncado con elisión del medio; resumen de compactación con anclas; skills en índice bajo demanda.

### M-006 — Otras

- **Estado:** idea
- `session_search` con ranking y fecha; `doctor` que avise de modelos configurados que ya no existen
  (reutiliza M-001 `--check`); limpieza de worktrees huérfanos al arrancar (`S/cli/worktree-sweep/`).
