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

### M-001 — Selector de modelos por agente (cadena con fallback) + gratis/local

- **Estado:** hecho (CLI + arreglo del plugin + `/omo-models` en la TUI).
- **Forma más simple — `/omo-models` dentro de OpenCode:** eliges agente → buscador con TODOS los modelos que
  OpenCode ve ahora, agrupados: "OpenCode Zen · Free", "OpenCode Zen" y luego cada proveedor ("Free" o precio a la
  derecha) → primario → fallbacks ("✓ Done, save" arriba) → se guarda en `~/.omo/omo.jsonc`. Reinicia OpenCode
  para aplicarlo. Código: `S/features/omo-models/`.
- **Uso rápido:**
  ```bash
  oh-my-opencode config models                    # menú interactivo
  oh-my-opencode config models --check            # qué modelos configurados ya no existen + estado de Ollama
  oh-my-opencode config models --preset free      # todo con modelos gratis (Zen free / :free)
  oh-my-opencode config models --preset mixed     # explore/librarian en local, resto gratis en la nube
  oh-my-opencode config models --connect-ollama   # declara tus modelos de Ollama en opencode.json (con backup)
  oh-my-opencode config models --rank explore --source free --top 10
  oh-my-opencode config models --agent explore --models opencode/a,opencode/b --enable-runtime-fallback
  ```
  `OMO_OLLAMA_URL` (o `OLLAMA_HOST`) cambia la URL de Ollama; `OMO_OLLAMA_URL=off` desactiva la detección.
- **Menú interactivo** (cursor `●/○` visible; solo los 11 agentes de oh-my-openagent):
  arreglar agentes rotos · aplicar preset · configurar un agente (cadena sugerida o elegir tú: primario →
  fallbacks, con "Search all models...") · configurar todos · filtrar origen (gratis / local / todos) ·
  conectar modelos de Ollama · guardar (resumen + confirmación) · salir.
- **Ranking (0-100):** razonamiento, contexto, costo, antigüedad, bonus si es recomendado por omo (`*`).
  Penaliza sin tool calling, sin imagen para `multimodal-looker`, modelos especializados (safety/voz/embeddings).
  Avisa de modelos locales < 7B ("often fails at tool use"). Pesos en `S/cli/config-models/agent-profiles.ts`.
- **Presets:** `free` reparte los primarios entre modelos de puntuación parecida (los tiers gratis limitan por
  modelo); `local` solo Ollama; `mixed` local primero en explore/librarian y un modelo local como último
  fallback en el resto.
- **Ollama:** lee `/api/tags` y `/api/show` (contexto real, tamaño, capacidades tools/vision/thinking).
  Si están instalados pero no en `opencode.json`, ofrece añadirlos (`provider.ollama`, `@ai-sdk/openai-compatible`).
- **Arreglos en el plugin (probados en OpenCode real):** antes, un primario que ya no existe se usaba igual y el
  agente fallaba. Ahora: (1) la resolución salta el primario si su proveedor no lo lista y hay fallbacks
  (proveedores desconocidos como ollama se respetan), (2) los agentes integrados reciben `fallback_models`,
  (3) los overrides ya no reponen el modelo retirado, (4) `config models` siembra el caché de proveedores del
  plugin (antes solo se creaba tras abrir la TUI, nunca en `opencode run`).
- **Límites:** los metadatos vienen de models.dev (sin velocidad ni benchmarks): el ranking orienta, no es
  verdad absoluta. La detección de Ollama se probó con respuestas simuladas, no contra tu Ollama real.

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
