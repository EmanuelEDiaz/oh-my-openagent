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

---

# 0.21, entrega 2 — Contraseñas de prueba guardadas

Hecha en la rama `feat/test-credentials`, que parte de la entrega 1. **Estado:** implementada y probada; la QA en la
interfaz real está pendiente (RAM).

```mermaid
sequenceDiagram
    participant A as Agente
    participant G as Plugin
    participant S as Shell
    A->>G: bash: CREATE USER app PASSWORD 'x' (o escribe .env / compose / .sql)
    G->>G: captura → .omo/secrets/credentials.json (0600, se ignora sola)
    G-->>A: "guardada como postgres-user-app: usa ${OMO_SECRET:postgres-user-app}"
    A->>G: bash: psql "postgres://app:${OMO_SECRET:postgres-user-app}@…"
    G->>G: reescribe a "${OMO_SECRET_POSTGRES_USER_APP}" según las comillas
    G->>S: shell.env inyecta el valor solo para esa llamada
    S-->>G: salida
    G-->>A: salida con [secret:postgres-user-app] en lugar del valor
    A->>G: git commit (con el valor dentro) → BLOQUEADO
```

- **Captura** (`features/credentials/capture.ts`):
  - SQL: `CREATE/ALTER USER|ROLE … PASSWORD` (Postgres) e `IDENTIFIED BY` (MySQL);
  - variables: `POSTGRES_PASSWORD`, `PGPASSWORD`, `MYSQL_*`, `MARIADB_*`, `MONGO_INITDB_ROOT_PASSWORD`,
    `REDIS_PASSWORD`, `DB_PASSWORD` y `*_DB_PASS(WORD)`;
  - URLs `postgres|mysql|mongodb|redis|amqp://u:p@host/db` y `htpasswd -b`;
  - en los `.env`, `compose*.yml` y `.sql` que escribe el agente, con archivo y línea;
  - nunca captura referencias (`$X`, `${X}`, `${OMO_SECRET:x}`), marcadores (`<password>`, `***`) ni valores vacíos.
- **Almacén** (`store.ts`):
  - `.omo/secrets/credentials.json`, con la carpeta en 0700, el archivo en 0600 y un `.gitignore` propio (`*`);
  - guarda el historial de valores anteriores;
  - un archivo ilegible se aparta, nunca se sobrescribe;
  - solo tacha valores de 6 caracteres o más.
- **Uso sin verlo** (`inject.ts`): `${OMO_SECRET:nombre}` se reescribe como una referencia a variable de entorno,
  adaptada a si va sin comillas, entre dobles o entre simples, y el valor se inyecta por `shell.env` solo para esa
  llamada. Un nombre desconocido se rechaza antes de ejecutar.
- **Tachado:** cualquier salida de herramienta (`bash`, `read`…) muestra `[secret:nombre]` en lugar del valor.
- **Git:** se bloquean `git add -f .omo/secrets` y los commits cuyos cambios preparados contienen un valor guardado
  (con `commit -a`, también los no preparados).
- **Herramienta:** una sola, `credential`, con las acciones `get`, `list` y `save`, y una descripción de menos de 400
  caracteres para no gastar contexto. `reveal` solo se usa si el usuario lo pide.
- El bloqueo por contraseña fallida (entrega 1) ahora remite a `credential({ action: "list" })`.
- Todo se apaga junto con `shell_safety` (protegido: solo desde la configuración del usuario).

## Pruebas que lo validan

| Prueba | Casos |
| --- | --- |
| `credentials/capture.test.ts` | 20: 10 formas de fijar una contraseña, `.env` con línea, compose en sus dos estilos y 8 referencias o marcadores que no se capturan |
| `credentials/store.test.ts` | 6: permisos 0600/0700 y `.gitignore`, historial, sin cambios, la lista sin valores, el tachado con longitud mínima, el archivo ilegible apartado |
| `credentials/inject.test.ts` | 7: el valor no aparece en el comando; **en una shell real** llega intacto sin comillas, entre dobles y entre simples (con espacios y comillas dentro); nombre desconocido; sin referencias no se toca; tachado del más largo primero |
| `credentials/guard.test.ts` | 9: captura desde un comando y desde un `.env` con línea, tachado en `read`, `shell.env` una sola vez por llamada, nombre desconocido, `add -f`, commit con el valor y commit limpio |
| `tools/credentials/tools.test.ts` | 5: `save`/`get` devuelven la referencia y no el valor, `reveal`, `list` sin valores, nombre desconocido, descripción corta |
| `hooks/credentials-guard/index.test.ts` | Extremo a extremo con un repositorio git real: captura, `shell.env` y bash real, tachado y commit bloqueado |
| Regresión | `shell-safety` 136/136, `config` 193/193, `plugin/hooks` 7/7 y todos los `plugin/*.test.ts` sin fallos |

## Fuera de esta entrega, para decidirlo con el usuario

- **Llavero del sistema** (`Bun.secrets`): el plan lo proponía "cuando exista". Es una API experimental y en Linux
  necesita libsecret y una sesión D-Bus. El archivo 0600, ignorado por git, cubre el caso de las contraseñas de
  prueba. Si se quiere, se añade como almacén preferente, con el archivo como respaldo.
- Windows: 0600 no protege; habría que usar `icacls`, o el perfil del usuario.
