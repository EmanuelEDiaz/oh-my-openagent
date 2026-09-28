# Plan: base de conocimiento verificable + worktrees seguros

Estado: **borrador para revisión** (no se ha programado nada de este plan).
Parte del roadmap: `docs/fork/roadmap.md`. Rutas: `S/` = `packages/omo-opencode/src/`, `TC/` = `packages/team-core/src/`.
Orden acordado: **Pieza 4 → 1 → 2 → 3**. Cada pieza se entrega por separado, probada, y se revisa antes de la siguiente.

Método para cada paso: test que falla primero (RED) → implementación → test verde → QA real en OpenCode
aislado (XDG sandbox, sin tocar tu `opencode.db`) → evidencia local en `.omo/evidence/` → commit.

---

## Pieza 4 — Worktrees seguros (bug de pérdida de datos)

### Problema confirmado en el código
- `S/features/team-mode/team-runtime/create.ts:76-80` — `createMemberWorktree` solo hace `mkdir`; no crea un
  worktree de git ni valida la ruta. El miembro arranca en una carpeta vacía.
- `S/features/team-mode/team-runtime/cleanup-team-run-resources.ts:66-68` y
  `S/features/team-mode/team-runtime/shutdown-helpers.ts:68-77` (`removeWorktrees`, llamado desde
  `delete-team.ts:178`) hacen `rm -rf` de esa ruta. **Si `worktreePath` apunta a una carpeta existente, se borra.**
- `TC/team-worktree/cleanup.ts` `removeWorktree` hace `fs.rm` **antes** de preguntar a git si es un worktree
  (mismo riesgo). `TC/team-worktree/manager.ts` `createWorktree` (con `git worktree add --detach`) existe pero
  nadie lo usa.

### Pasos
| # | Qué | Archivos |
|---|---|---|
| 4.1 | Test RED que reproduce el borrado: carpeta existente con un archivo como `worktreePath` → crear equipo → borrar equipo → el archivo desaparece. | `S/features/team-mode/team-runtime/*.test.ts` |
| 4.2 | `removeWorktree` seguro: consultar `git worktree list --porcelain`; si la ruta **no** está registrada como worktree → error y **no se borra nada**. Si está registrada: `git worktree remove` + `git worktree prune`. Eliminar el `fs.rm` previo. | `TC/team-worktree/cleanup.ts` |
| 4.3 | Proteger trabajo sin guardar: si el worktree tiene cambios sin commitear, no se elimina; se conserva y se informa la ruta. | `TC/team-worktree/cleanup.ts` |
| 4.4 | `createMemberWorktree` real: `validateWorktreeSpec` + rechazar rutas que ya existen + `createWorktree` (git). Si el proyecto no es un repo git → error claro en vez de `mkdir`. Guardar en el estado del miembro `worktreeCreatedByOmo: true`. | `S/.../create.ts`, tipos de runtime state |
| 4.5 | Limpieza solo de lo creado por omo: `cleanup-team-run-resources` y `removeWorktrees` solo actúan sobre miembros con `worktreeCreatedByOmo` y usan el `removeWorktree` seguro. El borrado del directorio de estado del plugin (`delete-team.ts:188`) pasa a una función aparte que solo acepta rutas dentro del directorio base de omo. | `cleanup-team-run-resources.ts`, `shutdown-helpers.ts`, `delete-team.ts` |
| 4.6 | Tests con git real en repos temporales (crear, borrar, carpeta existente, cambios sin guardar, no-git). | `TC/team-worktree/*.test.ts`, team-runtime tests |
| 4.7 | QA real: team-mode activado en sandbox, equipo con un miembro en worktree → el miembro trabaja en un checkout real → borrar equipo → `git worktree list` limpio y carpeta ajena intacta. | evidencia local |

### Criterios de aceptación
- Dado un `worktreePath` que apunta a una carpeta existente, cuando se crea el equipo, entonces la creación falla y la carpeta queda intacta.
- Dado un worktree creado por omo sin cambios, cuando se borra el equipo, entonces desaparece de `git worktree list` y del disco.
- Dado un worktree con cambios sin commitear, cuando se borra el equipo, entonces se conserva y el informe muestra su ruta.
- Dado un proyecto que no es repo git, cuando un miembro pide worktree, entonces el error lo dice explícitamente y no se crea ninguna carpeta.

### Opcional (4b, después)
`ulw-execute` crea el worktree solo por instrucción en el prompt. Hook que compruebe que el `worktree_path`
guardado en `.omo/boulder.json` es un worktree real registrado, y que al terminar recuerde su limpieza.

---

## Pieza 1 — Índice de conocimiento del proyecto

Objetivo: que la IA **busque** información real y citable en lugar de suponer.

### Pasos
| # | Qué | Archivos |
|---|---|---|
| 1.1 | Shim aprobado para SQLite (el repo prohíbe importar `bun:*` fuera de `bun-*-shim.ts`). | `S/shared/bun-sqlite-shim.ts` (+ test) |
| 1.2 | Almacén: `.omo/knowledge.db` por proyecto. Tabla `documents(id, kind, source, locator, title, body, content_hash, updated_at)` + tabla FTS5 `documents_fts(title, body)` con `unicode61 remove_diacritics 2` (español/inglés) y triggers de sincronización. `kind` ∈ `decision · plan · notepad · agents_md · commit · session`. `locator` es lo citable: `ruta:línea`, `commit:<sha>`, `session:<id>#<mensaje>`. | `S/features/knowledge/store.ts` |
| 1.3 | Indexador de archivos: `AGENTS.md`, `.omo/plans/*.md`, `.omo/drafts/*.md`, `.omo/notepads/**/*.md` y globs configurables. Trocea por encabezados markdown guardando la línea de inicio. Incremental por hash de contenido. | `S/features/knowledge/index-files.ts` |
| 1.4 | Indexador de git: últimos N commits (por defecto 500): sha, asunto, cuerpo y archivos tocados. | `S/features/knowledge/index-git.ts` |
| 1.5 | Indexador de sesiones: al quedar una sesión inactiva (`session.idle`) indexa el texto de usuario y asistente (no las salidas de herramientas), por mensaje. | `S/features/knowledge/index-sessions.ts` |
| 1.6 | Cuándo se indexa: al arrancar el plugin (en segundo plano, sin bloquear), en `session.idle` y tras `write`/`edit` de archivos indexados. | hooks en `S/plugin/*` |
| 1.7 | Herramienta `knowledge_search(query, kinds?, limit=8)`: ranking BM25, fragmento con coincidencias, y por resultado: tipo, **locator citable**, fecha y puntuación. Si una búsqueda con todos los términos no da resultados, reintenta con cualquiera de ellos (arregla el problema actual de "un término falta → 0 resultados"). | `S/features/knowledge/tool.ts`, `S/plugin/tool-registry-core-tools.ts` |
| 1.8 | Config `knowledge: { enabled, include_globs, git_commits, index_sessions }` en el esquema + regenerar `assets/omo.schema.json`. | `S/config/schema/*` |
| 1.9 | Tests (ranking, incremental, troceado con líneas correctas, tolerancia a términos) + QA real: sesión en sandbox que pregunta algo solo respondible desde un plan/commit → usa la herramienta y cita el locator. | |

### Criterios de aceptación
- Dado un plan con la frase "usamos Redis por la latencia" en la línea 40, cuando se busca "por qué redis", entonces el primer resultado es `.omo/plans/x.md:40`.
- Dado un archivo indexado que se edita, cuando se busca su nuevo contenido, entonces aparece sin reindexar todo.
- Dada una consulta con un término inexistente, entonces igualmente devuelve los resultados que coinciden con el resto.
- El arranque de OpenCode no se retrasa de forma perceptible (indexado en segundo plano).

---

## Pieza 2 — Registro de decisiones citado

Objetivo: cada "por qué se hizo así" queda escrito **con evidencia comprobable**.

### Pasos
| # | Qué | Archivos |
|---|---|---|
| 2.1 | Esquema de decisión: `id` (`D-20260927-1`), `title`, `decision`, `why`, `alternatives[]`, `evidence[]` (**mínimo 1**; cada una `{type: file·commit·url·session, ref, note}`), `status` (`active`·`superseded`), `supersedes?`, `agent`, `session`, `created_at`. | `S/features/knowledge/decisions/schema.ts` |
| 2.2 | Almacenamiento legible: `.omo/decisions/D-....md` (frontmatter YAML + texto) e indexado como `kind=decision`. | `.../decisions/store.ts` |
| 2.3 | Herramienta `decision_record(...)`: valida las citas **al escribir** (usa el verificador de la pieza 3: el archivo existe, la línea está en rango, el commit existe) y **rechaza** citas inválidas con un error claro. Guarda un hash de las líneas citadas para detectar cambios después. | `.../decisions/tool.ts` |
| 2.4 | Herramienta `decision_search(query)`: búsqueda solo en decisiones, mostrando estado y evidencias. | |
| 2.5 | Integración en prompts (breve): Sisyphus/Atlas/Hephaestus/Prometheus → "antes de decisiones de arquitectura, busca decisiones previas; tras una decisión no obvia, regístrala con evidencia". Arreglar el hueco actual: Atlas no relee `decisions.md` (`S/hooks/atlas/verification-reminders.ts:88-101`). | prompts de agentes, atlas |
| 2.6 | Los `decisions.md` existentes de notepads se indexan tal cual (`kind=notepad`), sin convertirlos. | |
| 2.7 | Tests + QA real: pedir una decisión con cita falsa (`src/x.ts:9999`) → se rechaza; con cita válida → se guarda y se encuentra. | |

### Criterios de aceptación
- Dada una decisión sin evidencia, cuando se registra, entonces se rechaza.
- Dada una cita a una línea fuera de rango o a un commit inexistente, entonces se rechaza indicando cuál y por qué.
- Dada una decisión que sustituye a otra, entonces la anterior pasa a `superseded` y ambas enlazan entre sí.

---

## Pieza 3 — Verificador de citas y control de "terminado"

Objetivo: detectar citas inventadas o desactualizadas y no aceptar "hecho" sin pruebas.

### Pasos
| # | Qué | Archivos |
|---|---|---|
| 3.1 | Extractor de citas en texto: `ruta:línea`, `ruta:línea-línea`, `ruta#L10`, sha de commit (7–40 hex), URLs, `session:<id>`. | `S/features/knowledge/citations/parse.ts` |
| 3.2 | Verificador: el archivo existe en el worktree; la línea está en rango; si hay hash guardado → avisa "cambió desde que se citó"; el commit existe (`git cat-file -e`); las URLs solo se validan de formato (sin red por defecto). | `.../citations/verify.ts` |
| 3.3 | Herramienta `verify_citations(text)`: resultado por cita → `ok · archivo no existe · línea fuera de rango · cambió · commit desconocido`. | |
| 3.4 | Hook sobre resultados de subagentes (`task`, `call_omo_agent`): verifica sus citas y añade al final `[citation check] 2 inválidas: foo.ts:999 (el archivo tiene 120 líneas)` para que el orquestador lo vea. | `tool.execute.after` |
| 3.5 | Control de "terminado": al marcar una tarea del plan como hecha (`- [x]` en boulder / todos), comprobar que la evidencia declarada existe; si falta → aviso (modo `warn`) o bloqueo (modo `block`). Semántica tomada del gate de Codex (`omo-codex/plugin/components/ulw-loop/src/spawn-guard.ts`). | hooks de boulder/todo |
| 3.6 | Informe de deriva: comando `oh-my-opencode knowledge check` (y `/omo-knowledge` en la TUI) que lista decisiones cuyas evidencias cambiaron o desaparecieron. | CLI + TUI |
| 3.7 | Tests + QA real: subagente devuelve una cita falsa → el orquestador recibe el aviso; tarea marcada como hecha sin evidencia → aviso/bloqueo. | |

### Criterios de aceptación
- Dado un informe de subagente con `src/a.ts:500` y el archivo tiene 120 líneas, entonces el resultado incluye el aviso con esa cita.
- Dada una decisión cuya línea citada se modificó, cuando se ejecuta `knowledge check`, entonces aparece como "cambió desde que se citó".
- Dado el modo `block`, cuando se marca hecha una tarea sin evidencia existente, entonces no se acepta y se explica qué falta.

---

## Decisiones tomadas (27-09-2026)
1. **Código dentro del plugin:** `S/features/knowledge/`.
2. **Decisiones en git con control de versiones correcto:** `.omo/` y `plans/` están en `.gitignore`, así que
   las decisiones **no** van a `.omo/decisions/`. Van a `docs/decisions/D-<fecha>-<n>-<slug>.md` (versionado).
   Si hay un plan activo en `/plans/<slug>.md` (formato de tu biblioteca), además se añade la entrada al
   `## Decisions log` de ese plan. Las de `Reversibility: hard` se marcan como candidatas a ADR (`docs/adr/`).
3. **"Hecho" exige evidencia:** modo `block` por defecto.
4. **Indexar sesiones:** sí.
5. **Activado por defecto:** sí.

## Cambios al plan tras revisar tu biblioteca y tus agentes
- **Formato de decisión = el de tu `planning-log.md`:** Context · Options considered · Decision · Reason ·
  Reversibility · Evidence session (`ses_… → msg_… → prt_…`), más la lista `evidence[]` verificable.
  No se inventa un formato nuevo.
- **Sesiones (1.5):** en vez de pedir los mensajes por la API, se lee `~/.local/share/opencode/opencode.db`
  en **solo lectura**, como ya validaste en tu script `opencode-session-search.py` (FTS5, ~2 ms). El locator
  de una sesión es `ses_… → msg_… → prt_…` y la herramienta devuelve también el comando de re-auditoría
  `opencode run --session <id> --fork`.
- **Archivos indexados (1.3):** además de `.omo/…`, también `/plans/**/*.md`, `CHANGELOG.md`, `docs/adr/*.md`
  y `docs/decisions/*.md` (los dos sistemas de planes quedan buscables).
- **Gate de "hecho" (3.5):** cubre también las casillas `- [x]` de `/plans/*.md`, alineado con tu regla
  "marcar solo cuando el criterio pasó con evidencia".
- **Nueva pieza 6 — reglas bajo demanda:** tus instrucciones globales cargan ~24.5k tokens en **cada** sesión
  (incluidos ~7k de REST API y los 4 lenguajes + 3 frameworks aunque el proyecto no los use). El
  `rules-injector` del plugin puede inyectar cada archivo solo cuando se lee un archivo que le corresponde
  (p. ej. `languages/go.md` al tocar `**/*.go`). Requiere tu aprobación porque cambia cómo se carga tu biblioteca.

## Control de versiones
- Una rama por pieza desde `mis-mejoras` (`fix/team-worktree-safety`, `feat/knowledge-index`,
  `feat/cited-decisions`, `feat/citation-verifier`), commits convencionales pequeños (uno por subtarea con su
  test), y merge a `mis-mejoras` con `--no-ff` (merge commit, como exige el repo). Evidencia de QA solo local.
