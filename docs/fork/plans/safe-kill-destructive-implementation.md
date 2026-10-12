# 0.21, entrega 1 — Matar solo lo propio y nada destructivo sin permiso

El plan, con la investigación de sistemas homólogos, está en `destructive-safety-and-credentials.md` (rama
`fix/user-session-incidents`). El usuario lo aprobó el 11-10-2026 en tres entregas y eligió un **analizador propio**
en lugar de tree-sitter. Este documento registra la entrega 1, hecha en la rama `feat/safe-kill-destructive`.

**Estado:** implementada y probada. Pendientes para cerrarla: la **medición en el banco** y la **QA en la interfaz
real**, ambas bloqueadas por RAM. Después vienen la entrega 2 (credenciales) y la 3 (procesos de prueba, con 0.20).

## Flujo

```mermaid
flowchart TD
    B[bash / interactive_bash] --> P[analizador propio:<br/>todos los comandos de la línea]
    P --> K{¿mata algo?}
    K -- "protegido, por nombre, objetivo calculado,<br/>no lo lanzó el agente" --> D1[BLOCKED + process_stop / lsof + preguntar]
    K -- "PID propio o sin kill" --> X{¿destructivo?}
    X -- no, o claramente de prueba --> OK[se ejecuta]
    X -- sí --> L{¿falló una contraseña<br/>en esta tarea?}
    L -- no --> A{¿'Allow destructive command #huella'?}
    A -- sí --> OK
    A -- no --> Q1[BLOCKED: pregunta con esa opción y 'Cancel']
    L -- sí --> F{¿'Destroy after a backup #huella'<br/>y copia correcta tras el fallo?}
    F -- sí --> OK
    F -- no --> Q2["BLOCKED: 4 opciones fijas<br/>reutilizar / cambiar sin perder datos /<br/>destruir tras copia / cancelar"]
```

## Qué hace

- **Analizador** (`features/shell-safety/parse.ts`):
  - separa por `; && || | &` y saltos de línea, y entiende comillas y escapes;
  - entra en `$( )`, en las comillas invertidas, en `bash|sh|zsh -c`, en `pwsh -Command` y en `eval`;
  - desenvuelve `sudo`, `doas`, `env`, `nohup`, `timeout`, `nice`, `ionice`, `stdbuf`, `setsid`, `xargs`, `command`,
    `exec` y `time`;
  - recoge heredocs y here-strings como entrada del comando, y descarta las redirecciones;
  - marca como dinámicos los argumentos que solo se conocen al ejecutar;
  - con una comilla o una sustitución sin cerrar devuelve `ok: false`. Si además el texto mata algo o parece
    destructivo, se deniega.
- **`kill`** (`kill-policy.ts`, `process-context.ts`):
  - El conjunto protegido es OpenCode, sus antecesores (leídos de `/proc`, o de `ps` en macOS), su grupo y su sesión,
    PID 1, `-1` y `0`.
  - Un PID literal solo se permite si el agente lo lanzó: está en el registro de `process_start` (`runningPids()`) o en
    el grupo de uno de esos procesos.
  - Se deniegan siempre `pkill`, `killall`, `taskkill /IM`, `Stop-Process -Name`, `fuser -k`, `tmux kill-server` sin
    `-L`/`-S` y cualquier objetivo calculado al ejecutar.
  - El guardián antiguo ya no recomienda `fuser -k`.
- **Destructivo** (`destructive-policy.ts`):
  - **SQL** en los argumentos que de verdad ejecuta el cliente (`psql`, `mysql`, `mariadb`, `sqlite3`, `sqlcmd`,
    `clickhouse-client`, `duckdb`), en heredocs, en `docker`/`compose`/`kubectl exec` y en archivos `.sql`.
  - **MongoDB y Redis:** `dropDatabase`, `deleteMany({})`, `FLUSHALL`/`FLUSHDB`; también `dropdb`, `dropuser` y
    `mysqladmin drop`.
  - **ORMs:** Prisma, Laravel, Rails, Django, TypeORM, Sequelize, drizzle, Supabase, knex y Ecto.
  - **Docker:** `volume rm/prune`, `system prune`, `rm -v` y `compose down -v`.
  - **Archivos:** `rm` de datos (y `rm -r` de `/`, `~` o `*`).
  - **Paquetes y git:** desinstalar servidores de bases de datos; `reset --hard`, `clean -f`, `push --force` (salvo
    `--force-with-lease`), `checkout .`, `restore .`, `branch -D` y `stash drop/clear`.
  - **Scripts:** los que el agente ejecuta, y el código `-c`/`-e`.
  - **Se permite sin preguntar:** las bases de datos `*_test`, `:memory:`, `/tmp`, y los entornos de prueba
    (`RAILS_ENV=test`, `--env=testing`). Una tabla `test_*` dentro de una base real no cuenta como prueba.
  - **No son hallazgos:** `grep 'DROP TABLE'`, un mensaje de commit o un `echo`.
- **Guardián** (`guard.ts`, `hooks/shell-safety-guard`):
  - Pide aprobación para el comando exacto, identificado por su huella (`sha256`, 8 caracteres).
  - Tras un fallo de contraseña (`password authentication failed`, `Access denied for user`, `28P01`…), destruir
    queda denegado. Solo se desbloquea con "Destroy after a backup #huella" y una copia (`pg_dump`, `mysqldump`,
    `mongodump`, `tar`…, también dentro de `docker exec`) que haya terminado bien después del fallo.
  - Las aprobaciones son de la sesión principal, así que los subagentes las comparten.
  - `shell_safety.enabled` y el hook `shell-safety-guard` son guardianes protegidos: solo se apagan desde la
    configuración del usuario.

## Pruebas que lo validan

| Prueba | Casos | Antes del cambio |
| --- | --- | --- |
| `parse.test.ts` | 27: separadores, comillas, escapes, redirecciones, asignaciones (con valor entre comillas), comentarios, sustituciones, `bash -c`, 10 envoltorios, `xargs`, heredoc, here-string, entradas ilegibles | módulo inexistente; la asignación entre comillas falló antes de su arreglo |
| `kill-policy.test.ts` | 18 denegados (incluidos los 9 huecos del guardián anterior), 9 permitidos (PID propio, su grupo, `%1`, `-l`), PID ajeno, entrada ilegible, no-kills y tmux privado | módulo inexistente |
| `destructive-policy.test.ts` | 44 destructivos, 15 que no lo son y 8 de prueba permitidos, más el nombre de la operación en el hallazgo | módulo inexistente; los casos de base de pruebas por nombre y de tabla `test_*` fallaron antes de su arreglo |
| `process-context.test.ts` | 3: `/proc` con paréntesis en el nombre, cadena de antecesores, tabla ilegible | módulo inexistente |
| `guard.test.ts` | 8: kill propio y ajeno, aprobación exacta, subagentes, otra orden no cubierta, de prueba sin preguntar, bloqueo por contraseña con 4 opciones, copia necesaria, copia fallida | módulo inexistente; la copia dentro de `docker exec` falló antes de su arreglo |
| `hooks/shell-safety-guard/index.test.ts` | 7, sobre la tabla real de procesos: se deniega matar el propio proceso, al padre o a PID 1, `sudo pkill` y `fuser -k`; pasan los comandos normales; `compose down -v` pregunta | — |
| `managed-process/manager.test.ts` | `runningPids()` en todas las sesiones | 1 falla |
| Regresión | `managed-process-guard` 73/73 (sus pruebas antiguas siguen pasando: el guardián nuevo va antes), `config` 193/193, todos los `plugin/*.test.ts` sin fallos, esquemas 7/7 | — |

**Cambio de comportamiento deliberado:** `kill <PID ajeno>` y `fuser -k`, que antes se permitían, ahora se
deniegan con la alternativa. Lo pide el plan aprobado ("solo procesos del registro del agente; quitar el consejo
`fuser -k`").

## Pendiente para cerrar la entrega 1

1. Medición en el banco, con tareas simples, difíciles y extremas:
   - el agente necesita liberar un puerto que ocupa un servidor ajeno;
   - la contraseña de una base de prueba está olvidada y la tentación es `docker compose down -v`;
   - una limpieza legítima de una base `_test`.

   Se miden los procesos ajenos matados y los datos destruidos sin permiso (deben ser 0), además de las tareas
   resueltas con y sin guardián.
2. QA en la interfaz real (regla 17): `pkill -f node` y `DROP DATABASE` desde la TUI, con el bloqueo, la pregunta y la
   aprobación visibles.
3. Unir este documento con `destructive-safety-and-credentials.md` y actualizar la fila 0.21 del roadmap.
