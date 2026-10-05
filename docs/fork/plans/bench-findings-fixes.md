# Arreglos de la validación de `loops-hard` (05-10-2026)

Estado: **implementado (05-10-2026), QA aislada en curso**, rama `fix/bench-findings`. `S/` = `packages/omo-opencode/src/`.

## Hallazgos y causa real (investigación del código y de los registros del entorno aislado)
1. **"El agente se para" (`round-half`)** — no fue una parada prematura. El agente lanzó los tests con `process_start`,
   cuya guía dice "no consultes: se te avisará o termina el turno". Los tests acabaron mientras el turno aún escribía:
   el aviso de proceso terminado se descartó (`promptAsync skipped because session is active`; `tell()` en
   `S/features/managed-process/manager.ts:111-121` ignora el resultado y no reintenta, a diferencia de
   `background-agent/parent-wake-prompt-dispatch.ts:73-95`). Además el banco da la tarea por terminada en el primer
   instante libre (`script/fork/bench/runner.ts:118-123`).
2. **Cuelgues de 240 s** — dos cosas distintas:
   - `csv-crlf`, `env-bool`: el modelo no envió nada tras empezar la petición. `chunkTimeout` (90 s) solo cubre huecos
     del **cuerpo** SSE ya iniciado; el tiempo hasta las cabeceras lo cubre `headerTimeout`, que OpenCode 1.18.26 solo
     pone por defecto a `openai` (300 s), no a `opencode` (`provider.ts` L35/L214, L1795-1825).
   - `bigint-json`: no era un cuelgue: el subagente `test-writer` tiene `bash: {"*": "ask"}`
     (`S/agents/specialists/catalog.ts:209`, igual en :237) y se quedó esperando permiso para `ls`/`cat`; el banco solo
     contestaba preguntas, no permisos. Un subagente síncrono bloqueado así es invisible para el padre.
   - El banco corta a 240 s, igual que el vigilante de 0.8 (240 s + comprobación cada 15 s): nunca se ve si el plugin
     recupera.
3. **`loops-hard` no provoca bucles en big-pickle** — problema de medición (modelo más débil o trampas más duras).

## Sistemas homólogos
Claude Code Stop hooks (`decision: "block"` + `stop_hook_active`); Gemini CLI `nextSpeakerChecker`; OpenHands
(usuario simulado "continúa… si está resuelto, termina" hasta `finish`); SWE-agent exige `submit`; Cline exige
`attempt_completion`; MAST (arXiv 2503.13657) cataloga la "terminación prematura". Tiempos: Codex
`stream_idle_timeout_ms` 300 s, OpenCode `headerTimeout` de OpenAI 300 s.

## Arreglos aprobados
- **A (plugin):** cola de avisos pendientes en `managed-process`: si el aviso llega con la sesión ocupada
  (`active`/`reserved`/`failed`), se guarda y se entrega en el siguiente `session.idle`, **una vez por proceso**.
- **B (plugin):** `headerTimeout` por defecto (90–120 s, configurable en `stall`) junto a `chunkTimeout`, sin pisar la
  configuración del usuario, para todos los proveedores incluido `opencode`.
- **C (plugin):** los especialistas con `bash` en "preguntar" (`test-writer` y el de :237) ejecutan sin preguntar los
  comandos de solo lectura (`ls`, `cat`, `head`, `tail`, `wc`, `git status/log/diff/show`, `pwd`, `find` sin acciones…);
  el resto sigue preguntando.
- **Banco:** fin de tarea solo tras ~5 s libre seguidos y sin procesos ni avisos pendientes; respuesta automática a
  permisos pendientes contada aparte (métrica "esperas de permiso"); corte del banco a 420 s y conteo de recuperaciones
  del vigilante (registro del plugin).
- **No ahora (decisión 05-10-2026):** detector de "anuncia trabajo y se para" (no habría ayudado aquí; riesgo de falsos
  positivos; se mide primero) y acortar el vigilante (primero medir los silencios reales del modelo).

## Pruebas
Cada arreglo con una prueba que falle antes; QA aislada: proceso que termina con la sesión ocupada → un aviso tras quedar
libre; proveedor simulado que retiene las cabeceras → error a los N s y reintento; `test-writer` ejecuta `ls` sin
pedir permiso y sigue pidiéndolo para `rm`; repetir la validación de `loops-hard` y las tareas que fallaron.

## Implementación (05-10-2026)
- **A — avisos de proceso terminado** (`S/features/managed-process/manager.ts`, `plugin.ts`, `S/plugin/event.ts`):
  `notify` devuelve si el aviso se entregó (`isInternalPromptDispatchAccepted`); si no (sesión activa, reservada o
  error), queda pendiente por proceso (el último aviso de un proceso reemplaza al anterior) y se entrega en el siguiente
  `session.idle` (`onSessionIdle`), con hasta 3 reintentos cada 5 s; se borra al aceptarse (una entrega por proceso) o al
  borrar la sesión. `processes.json` guarda `told` y `noticePending` (el banco los lee).
  Pruebas: 3 en `manager.test.ts` (proceso termina con la sesión ocupada → un aviso tras dos `idle`; reintento por
  temporizador; sesión borrada) + 1 en `event.monitor.test.ts`. Antes: 3 + 1 fallaban; ahora 12/12 y 4/4.
  De paso: `manager.test.ts` dejaba carpetas `managed-process-*` en `/tmp` (una prueba llamaba dos veces a `setup()`);
  arreglado.
- **B — `headerTimeout` por defecto** (`S/plugin-handlers/stall-chunk-timeout.ts`, `config-handler.ts`,
  `S/config/schema/stall.ts` → `header_timeout_ms`, entero ≥ 10 000 o `false`, por defecto 120 000): se aplica a
  `opencode` y a todos los proveedores conectados salvo que el usuario lo haya fijado (incluido `false`); **`openai` se
  deja con los 300 s que pone OpenCode**. Comprobado en OpenCode 1.18.26: `headerTimeout` se lee junto a `chunkTimeout`
  en el envoltorio de `fetch` de todos los proveedores y, al saltar, da `HeaderTimeoutError` → `APIError` reintentable.
  Esquemas `assets/*.schema.json` regenerados (incluyen la sección `resilience`, que faltaba). Pruebas: 4 nuevas en
  `stall-chunk-timeout.test.ts` + 1 en `stall.test.ts`; antes 2 fallaban; ahora 7/7, 3/3 y `config-handler` 52/52.
- **C — comandos de solo lectura** (`S/agents/specialists/catalog.ts`, conjunto `READ_ONLY_SHELL` tras `"*": "ask"`):
  permitidos `ls*`, `pwd`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `git status/log/diff/show`; vuelven a
  "preguntar" `find` con `-exec`/`-execdir`/`-ok`/`-delete`/`-fprint` y **cualquier comando con `;`, `&`, `|`, `>`, `<`,
  comillas invertidas, `$(` o salto de línea** (OpenCode compara la cadena entera, así que `ls && rm x` no debe colarse).
  Las reglas de ejecutar tests y las denegaciones destructivas van después y siguen ganando. Aplicado a `test-writer` y
  `debugger` (en el `debugger` sustituye sus reglas de lectura de git; `git bisect*` sigue). El `verifier` (también en
  "preguntar") no se tocó: fuera del plan. Prueba de orden de reglas que reproduce el "gana la última": antes fallaba
  (`test-writer: ls => ask`), ahora 9/9.
- **Banco** (`script/fork/bench/runner.ts`, `run.ts`, `regrade.ts`): `STALL_MS` 420 s; en modo principal la tarea acaba
  solo tras 5 s libre seguidos sin preguntas ni permisos contestados en ese intervalo y sin procesos sin avisar ni avisos
  pendientes (`managedProcessesBusy` lee `.omo/proc/processes.json`); respuesta automática a permisos ("once") en ambos
  modos; dos notas informativas por tarea: `info:permissions` (número y hasta 5 peticiones) e `info:recoveries`
  (recuperaciones del vigilante leídas del registro del plugin del entorno aislado); totales por ejecución. Pruebas en
  `runner.test.ts`; `bun test script/fork/bench` 84/84.
- **Chequeo de tipos** del paquete y de `script/` limpios.

## QA aislada (en curso)
Proveedor que retiene las cabeceras (escenario `header-hold`, límite acortado a 15 s en el entorno aislado) y repetición
con el dist arreglado de las 4 tareas afectadas (`loops-hard/round-half`, `loops-hard/bigint-json`, `loops/csv-crlf`,
`loops/env-bool`). Resultados se añaden aquí al terminar.
