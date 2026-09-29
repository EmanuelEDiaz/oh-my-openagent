# Paso 0.2 — Borrar equipos desde otra ejecución

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **hecho (29-09-2026)**. Rutas: `S/` = `packages/omo-opencode/src/`.

## Diagnóstico (verificado en el código)
- `team_delete` (`S/features/team-mode/tools/lifecycle-shutdown-tools.ts:50`) autoriza por **participante**:
  `resolveParticipant` (`S/features/team-mode/tools/lifecycle-participant.ts`) busca la sesión que llama en el registro en
  memoria y, si no está, en el estado **en disco** (`runtimeState.leadSessionId` y `members[].sessionId`).
- Por eso el diagnóstico del roadmap era inexacto: el registro en memoria se pierde, pero hay respaldo en disco. Continuar la
  sesión líder (`opencode run --session <leadSessionId>`) sí puede borrar.
- El fallo real (QA de 0.1, `.omo/evidence/20260927-team-worktree-safety/summary.md:8`): un `opencode run` nuevo crea una
  **sesión nueva** que no es líder ni miembro → `"team_delete is lead-only"`. Ni siquiera `force` sobre un equipo `orphaned`
  pasa, porque el atajo exige `participant !== undefined` (línea 55).
- El único limpiador automático es `team-lead-orphan-handler` (al borrar la sesión líder) y `resumeActiveTeam` al arrancar
  (marca `orphaned` si la sesión líder no existe o todos los workers murieron). Si la sesión líder sigue existiendo pero su
  proceso terminó, el equipo queda `active` para siempre, con sus worktrees.
- No hay comando de CLI para listar o borrar equipos.

## Propuesta
1. **Mensaje de error accionable**: `team_delete` rechazado indica la sesión líder, su estado, y las dos salidas
   (`opencode run --session <lead>` o `oh-my-openagent team delete <teamRunId>`).
2. **CLI para el humano** (fuera del control del modelo), junto a `knowledge`:
   - `team list [--all]`: id, nombre, estado, sesión líder (y si existe aún en `opencode.db`, en solo lectura), miembros y
     worktrees.
   - `team delete <teamRunId> [--force] [--dry-run]`: reutiliza `deleteTeam` sin tmux/background de otro proceso. Sin
     `--force` exige los mismos estados borrables que la herramienta; `--dry-run` muestra qué se quitaría. Los worktrees
     siguen protegidos por 0.1 (los que tienen trabajo sin guardar se conservan y se listan).
3. **Herramienta desde otra sesión** (a decidir): permitir `team_delete` con `force=true` a una sesión no participante
   **solo** si el equipo está `orphaned` o atascado en `deleting`. Un equipo `active` sigue siendo solo del líder.

## Subtareas
- [x] 1. Tests RED: sesión ajena + `orphaned` + `force` (según decisión 3); mensaje de error; CLI list/delete/dry-run.
- [x] 2. Mensaje accionable en `team_delete`.
- [x] 3. `S/cli/team-admin.ts` + registro en `cli-program.ts`.
- [x] 4. (Si se aprueba) atajo para sesión ajena en equipos `orphaned`/`deleting`.
- [x] 5. QA real en sandbox: crear equipo en `opencode run` A; en B comprobar el mensaje; borrar con el CLI; confirmar que
  los worktrees limpios se quitan y uno con cambios se conserva.
- [x] 6. Docs, evidencia, merge y push; limpiar sandbox.

## Resultado (29-09-2026)
- Decisión del usuario: punto 3 aprobado (sesión ajena + `force` en equipos `orphaned`/`deleting`).
- Hallazgo en el código: el hook `team-tool-gating` rechazaba a cualquier no líder **antes** de la herramienta, así que el
  atajo del upstream para miembros nunca se ejecutaba en producción. Ahora ambos aplican la misma regla y el mismo mensaje.
- Hallazgo en la QA: al salir con normalidad, `opencode run` ya borra los equipos que creó (`cleanupSessionTeamRuns`). Los
  equipos quedan colgados cuando el proceso muere de golpe; reproducido con `kill -9`.
- QA real: los 4 escenarios pasan (evidencia en `.omo/evidence/20260929-team-delete-cross-process/`).

## Criterios de aceptación
```gherkin
Feature: borrar equipos desde otra ejecución

  Scenario: mensaje accionable
    Given un equipo creado en otra ejecución
    When una sesión nueva llama a team_delete
    Then el error nombra la sesión líder y los comandos para continuar o borrar desde el CLI

  Scenario: borrado desde el CLI
    Given un equipo "active" cuya sesión líder ya no corre
    When el usuario ejecuta "team delete <id> --force"
    Then el estado del equipo desaparece, los worktrees limpios se quitan y los que tienen cambios se conservan y se listan

  Scenario: vista previa
    When el usuario ejecuta "team delete <id> --dry-run"
    Then se listan estado, miembros y worktrees afectados sin tocar nada

  Scenario: un equipo activo sigue protegido frente al modelo
    Given un equipo "active"
    When una sesión que no es líder llama a team_delete con force
    Then se rechaza
```
