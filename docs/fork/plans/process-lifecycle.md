# Paso 2.10 — Procesos gestionados: arrancar, parar, avisar y no matarse a sí mismo

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **plan (29-09-2026)**. Rutas: `S/` = `packages/omo-opencode/src/`.

## El problema
Los agentes arrancan servidores, watchers o contenedores y los dejan corriendo, no saben pararlos, no avisan cuando no
pueden, y a veces se matan a sí mismos (`pkill -f <patrón>` que coincide con su propio comando, `killall node`,
`kill` del PID equivocado). Pasó incluso en este mismo trabajo (roadmap, "Notas de QA").

## Cómo funciona hoy (verificado)
- El `bash`/`shell` de OpenCode lanza cada comando en su propio grupo de procesos y, al terminar, **solo mata el grupo si
  el comando falló o se agotó el tiempo**: un `npm run dev &` que sale con 0 deja el servidor huérfano
  (`anomalyco/opencode` `packages/core/src/cross-spawn-spawner.ts:373-402`; inferido del código). No hay herramienta de
  procesos en segundo plano (petición abierta https://github.com/anomalyco/opencode/issues/6375).
- El plugin tiene `monitor_start/stop/list/output` **desactivado por defecto** (`S/config/schema/monitor.ts:4`):
  - marca "stopped" antes de comprobar que el proceso murió (`S/features/monitor/manager.ts:108-126`);
  - no guarda PID/PGID/puerto/log;
  - ejecuta sin shell (sin pipes ni `&&`);
  - mata a los 30 minutos;
  - el `dispose` del plugin no lo apaga.
- Ya existe `terminateProcessTree` (`packages/utils/src/process-tree-termination.ts:32-64`): mata el grupo (TERM → KILL)
  y **devuelve qué PIDs sobrevivieron** — justo lo que falta para avisar.
- **Nada** protege contra `pkill`/`killall`/`kill` autodestructivos (`S/plugin/tool-execute-before.ts:73-90`).

## Cómo lo hacen otros
Claude Code: `run_in_background` con ID, lectura de salida por ID, lista de tareas y **limpieza al salir incluso de lo
que escapó con `setsid`** (https://code.claude.com/docs/en/interactive-mode#background-bash-commands). Codex: sesiones de
proceso con ID. Buenas prácticas: guardar PID/PGID, matar por grupo (`kill -TERM -PGID` → `-KILL`), nunca `pkill -f`
con patrones amplios, comprobar puertos y no nombres, limpiar al salir e informar de lo que sobrevive.

## Propuesta
1. **Procesos gestionados** (ampliando `monitor`, no duplicándolo), activado por defecto:
   - `process_start {name, command, cwd?, ready_port?, ready_pattern?, keep_alive?}`: con shell (pipes), grupo propio,
     log en `.omo/proc/<id>.log`; devuelve id, PID, PGID, puerto y log;
   - `process_status`, `process_logs`, `process_list`;
   - `process_stop` con `terminateProcessTree`: solo dice `stopped` si no sobrevive nada; si no, `stop_failed` con los
     PIDs y **el comando exacto** para que el usuario lo pare a mano;
   - sin límite de 30 minutos para servicios; registro en `.omo/processes.json` para detectar huérfanos tras un fallo.
2. **Guarda contra la autodestrucción** (`tool.execute.before`, bloquea):
   - `pkill`/`killall` amplios (`node|bun|opencode|tmux|bash|sh|zsh`);
   - `pkill -f` / `pgrep -f | xargs kill` cuyo patrón coincida con OpenCode, sus ancestros o el propio comando;
   - `kill` del PID de OpenCode, sus ancestros, `-1` o su grupo;
   - `tmux kill-server`.

   El mensaje ofrece la alternativa (`process_stop <id>`, `fuser -k <puerto>/tcp`).
3. **Avisos**: al quedar inactiva la sesión, si hay procesos del agente corriendo, un aviso ("siguen corriendo: web pid
   1234 :3000 hace 12 min — ¿pararlos o dejarlos?"); al cerrar sesión o el plugin, parar los que no sean `keep_alive` e
   informar de lo que no se pudo parar.
4. **Regla** (en el plugin, no en la biblioteca global): "los procesos largos se arrancan con `process_start`; al acabar
   se paran; si no se puede, dile al usuario el comando exacto".

## Criterios de aceptación
```gherkin
Feature: procesos gestionados
  Scenario: parar de verdad
    Given un proceso arrancado con process_start que lanza un nieto
    When se llama a process_stop
    Then ni el proceso ni el nieto siguen vivos y el estado es stopped
  Scenario: aviso cuando no se puede
    Given un proceso que sobrevive a TERM y KILL
    Then process_stop devuelve stop_failed con los PIDs y el comando manual
  Scenario: no matarse a sí mismo
    When el agente ejecuta "pkill -f node" o "kill -9 <pid de OpenCode>"
    Then la llamada se bloquea y sugiere process_stop
  Scenario: no olvidarse
    Given un servidor del agente corriendo
    When la sesión queda inactiva
    Then se avisa una vez de que sigue corriendo
```
