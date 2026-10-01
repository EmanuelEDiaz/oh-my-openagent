# Paso 4.9 — Especialista de control de versiones (`git-committer` ampliado)

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **diseño aprobado (01-10-2026)**; se implementa y mide con la plantilla
de la Fase 4 (`plans/per-agent-program.md`). Rutas: `S/` = `packages/omo-opencode/src/`.

## Punto de partida
- `git-committer` (2.2, `S/agents/specialists/catalog.ts`):
  - permisos que bloquean `push`, `--amend`, `--force`, `--no-verify`, `reset --hard`, `rebase` y `add -A`/`add .`;
  - `git add <rutas>` explícito;
  - escaneo de secretos de lo preparado;
  - estilo de mensajes del repo o Conventional Commits.
- Skill `git-master` (`packages/shared-skills/skills/git-master/SKILL.md`), que se le inyecta:
  - modos COMMIT/REBASE/HISTORY/STATUS;
  - grupos atómicos por comportamiento;
  - verificar lo preparado antes de cada commit;
  - rebase solo si se pide y con `--force-with-lease`;
  - comandos de historial.
- Lección propia: 67 commits del fork salieron con la identidad global de otra persona del mismo ordenador
  (corregido el 29-09-2026 reescribiendo el historial).

## Decisiones del usuario (01-10-2026)
| Decisión | Detalle |
|---|---|
| **Alcance** | Commits + ramas + merge. `push`, rebase y reescritura de historial **solo con aprobación** (pregunta con opciones). Las preguntas de historial (quién/cuándo/por qué) van a `explore`/`memory` (solo lectura). |
| **Dónde viven las reglas** | Reglas generales dentro del especialista + **política por proyecto** (identidad, ramas, formato de mensaje) detectada del historial o propuesta con el `rules init` de 4.5. La del proyecto manda. |
| **Identidad** | Ordenador compartido: **nunca** usar la identidad global. Primera vez en un proyecto: preguntar nombre y email, fijarlos **solo en ese repo** (`git config --local`) y guardarlos en la política. **En cada sesión, antes del primer commit**: confirmación corta ("¿commitear como X? sí / cambiar"). Bloquear por código un commit si la identidad local falta o no coincide con la política. |

## Reglas generales del especialista
1. **Identidad:** la de la política del proyecto, confirmada en la sesión (ver arriba). Antes de `push`, mostrar la
   cuenta de GitHub (`gh auth status`/`gh api user`) y confirmarla. Las credenciales no las ve ni las guarda: las
   gestionan `gh`/git, y si fallan se informa al usuario sin intentar arreglarlo.
2. **Ramas:**
   - nunca commitear directo en la rama principal si el proyecto trabaja con ramas;
   - una rama por tarea (`feat/…`, `fix/…`, `docs/…`);
   - merge con la convención del proyecto (p. ej. `--no-ff`);
   - no borrar ramas sin aprobación.
3. **Commits atómicos:** por comportamiento, con sus tests, y uno por casilla del plan cuando la hay. Su hash sirve de
   evidencia al evidence-gate (`commit:<sha>`).
4. **Mensaje:**
   - formato e idioma del repo (detectados del historial);
   - asunto corto en imperativo y cuerpo con el **porqué**;
   - referencias (`Refs #…`) y trailers que pida el proyecto.
5. **Antes de commitear:**
   - hooks siempre activos;
   - escaneo de secretos de lo preparado;
   - nada de `.env`, binarios, archivos grandes o generados sin su fuente;
   - comprobar `.gitignore`;
   - dejar sin commitear lo ajeno o dudoso, e informar.
6. **Subir y reescribir:** solo con aprobación; `--force-with-lease`; ramas de respaldo antes de reescribir;
   comprobar contra el remoto (`git ls-remote`) en vez de fiarse del mensaje de error. Ejemplo: los 408 que aun así subían.
7. **Recuperación:** nunca `reset --hard`; explicar el camino con `reflog` antes de usarlo.

## Qué se hace cumplir por código
- Identidad: `tool.execute.before` en `git commit` comprueba `user.name`/`user.email` locales contra la política y la
  confirmación de la sesión; si no hay, bloquea con la pregunta.
- Formato del mensaje: si la política define formato (p. ej. Conventional Commits), validación de `git commit -m`.
- Comandos prohibidos: ya están en sus permisos; `push`/`rebase` pasan a "preguntar" en vez de "denegar" cuando la
  política lo permite con aprobación.
- Commit directo en la rama principal: bloqueado si la política dice que se trabaja con ramas.

## Política del proyecto (ejemplo, en `.omo/rules/vcs.md` vía el guardián de reglas)
```yaml
id: vcs-policy
identity: { name: "emanuelediaz", email: "emanuelediaz25@gmail.com", confirm_each_session: true }
branches: { main: mis-mejoras, per_task: true, prefixes: [feat, fix, docs, chore], merge: no-ff }
messages: { format: conventional, language: en, trailers: ["Co-Authored-By"] }
push: { requires_approval: true, verify_remote: true }
```

## Criterios de aceptación
```gherkin
Feature: control de versiones
  Scenario: identidad del proyecto, no la global
    Given una identidad global distinta a la del proyecto
    When el especialista va a hacer el primer commit de la sesión
    Then pregunta/confirma la identidad del proyecto y commitea con la local, nunca con la global
  Scenario: sin rama de tarea
    Given la política dice que se trabaja con ramas
    When se intenta commitear en la rama principal
    Then se bloquea y propone crear la rama de la tarea
  Scenario: subir solo con aprobación
    When la tarea termina
    Then el especialista pregunta antes de push, muestra la cuenta de GitHub y verifica con ls-remote
```
