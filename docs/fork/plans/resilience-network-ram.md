# Paso 0.15 — Cortes de red, congelamientos y procesos matados sin perder nada

Parte del roadmap: `docs/fork/roadmap.md` (fila 0.15). Estado: **plan detallado, pendiente de aprobación (05-10-2026)**.
Rutas: `S/` = `packages/omo-opencode/src/`, `MC/` = `packages/model-core/src/`.

## Problema (usuario, 05-10-2026)
- Cambiar de red cortó la conexión unos instantes; la sesión no se recuperó sola.
- Pedido: reintentar con un límite visible, sin perder contexto, en la misma sesión.
- Ampliado: congelamientos por falta de RAM y procesos matados (earlyoom/OOM) — "no perder nada".
- El agente debe saber reanudar con cualquier texto ("continúa" u otro), no solo con un botón.

## Cómo está hoy (análisis del código, 05-10-2026)
- **Un corte de red se trata como fallo del modelo.** No hay clasificador de red en las rutas de reintento:
  - `runtime-fallback` (apagado por defecto) y `model-fallback` (activo) cambian al siguiente modelo de respaldo;
    `runtime-fallback` además **aborta el reintento propio de OpenCode** (`S/hooks/runtime-fallback/session-status-handler.ts:144`)
    y gasta `attemptCount` y el enfriamiento del modelo (`fallback-state.ts:68-92`).
  - Subagentes en segundo plano: cualquier estado `retry` gasta un intento (`S/features/background-agent/manager.ts:1944-1968`).
  - Vigilante de cuelgues (0.8): los estados `retry` repetidos no cuentan como avance; a los 240 s aborta, **carga el
    presupuesto compartido de 0.9b** y continúa con el siguiente modelo (`S/hooks/stall-watchdog/hook.ts:56-79`).
    Un congelamiento de más de 240 s tiene el mismo efecto.
- **El único clasificador de red** está en `S/features/background-agent/error-classifier.ts:9-25` (solo para saber si
  una sesión existe). Se reutiliza.
- **Reanudación existente (0.9b):** tarjeta `.omo/runs/<id>/resume.json` + `RESUME.md` (escritura atómica), al agotar
  el presupuesto, al cerrar con SIGTERM y con memoria alta. **Un SIGKILL no deja tarjeta.** La nota de reanudación solo
  se añade si el mensaje coincide con frases de reanudación (`S/features/resume/intent.ts:6-12`).
- **Estado en disco no atómico:** `run-continuation`, `boulder.json`, rules-injector, session-injected-paths,
  ralph-loop, cachés JSON, web-research cache, hook-message-injector, tool-result-storage y otros escriben con
  `writeFileSync` directo: un kill a mitad deja JSON roto. El ayudante atómico (`S/shared/write-file-atomically.ts`)
  usa un temporal de nombre fijo (`<ruta>.tmp`): dos escritores a la vez chocan.
- **Sin marca de trabajo en curso** (pid + latido) ni detección de huérfanos al arrancar.
- **Medición de memoria ya existe:** `S/features/resume/memory-watch.ts` (`MemAvailable`, respaldo `os.freemem()`).

## Sistemas homólogos (regla 15; investigación 05-10-2026, `[nv]` = sin verificar)
- **OpenCode** (`session/retry.ts`): reintenta solo 5 veces, 2 s ×2 con ±25 % de variación, tope 30 s, respeta `retry-after`; publica `attempt` y `next` en el estado `retry`. Guarda los mensajes en SQLite (WAL: sobreviven a un kill) y tiene instantáneas git ocultas (`snapshot/`).
- **Gemini CLI** (`utils/retry.ts`): 10 intentos 5→30 s; reconoce ECONNRESET, ETIMEDOUT, EPIPE, ENOTFOUND, EAI_AGAIN, ECONNREFUSED y errores SSL; **solo cambia de modelo con 429 persistente, nunca por red** (lo mismo que hacemos). Instantánea git + conversación antes de cada herramienta que modifica (`/restore`).
- **Codex CLI:** reintentos separados de petición (4) y de flujo (5) con "Reconnecting… N/5"; fallo conocido: cuelgue sin error antes de que empiece el flujo (#31376).
- **Cline:** al reanudar inyecta "[TASK RESUMPTION]… asume que la herramienta sin resultado no se completó"; fallo conocido: repite comandos que ya habían terminado (#12975).
- **OpenHands / Codex / Claude Code:** registro que solo crece (eventos/JSONL) + reanudar desde el último evento.
- **earlyoom:** SIGTERM al ≤10 % de memoria y swap, SIGKILL al ≤5 %; `-N script` avisa tras matar (pid, nombre, RSS); `--avoid` protege procesos.
- **Linux PSI** (`/proc/pressure/memory`): `full avg10` avisa antes que `MemAvailable` de que el sistema está atascado.
- **Windows:** `CreateMemoryResourceNotification` (bandas baja/alta) necesita FFI → usamos `os.freemem()`.

**Qué tomamos:** dejar actuar primero el reintento de OpenCode; códigos de red de Gemini + los de Bun/undici; sondeo doble (proveedor + sitio neutro por HTTPS); detección de flujo muerto sin error (Codex #31376); marca WIP fina con OpenCode como fuente de verdad (OpenHands/Codex); comprobación por código de las ediciones a medias y nunca repetir `bash` sola (evita el fallo de Cline); instantánea de OpenCode para deshacer; PSI y `oom_kill` para la causa; histéresis en la puerta de RAM.

## Diseño
### A. Red: esperar en vez de cambiar de modelo
1. `isNetworkError(error)` en `MC/` a partir de los patrones de `background-agent` + `EAI_AGAIN`, `ETIMEDOUT`,
   `ENETUNREACH`, `ECONNREFUSED`, `fetch failed`, `socket hang up` y `APIError` reintentable **sin código HTTP**.
   Se suman `EPIPE`, errores SSL `ERR_SSL_*BAD_RECORD_MAC`, los de undici (`UND_ERR_SOCKET`,
   `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, "other side closed") y los de Bun; los textos reales se
   recogen en la QA desconectando la red. Un 429/5xx con respuesta del servidor **no** es red (sigue el camino de
   respaldo de siempre).
2. Se consulta **antes** de cualquier respaldo en `runtime-fallback` (event, message-update, session-status),
   `model-fallback` (`S/plugin/event-model-fallback.ts`) y el reintento de subagentes: si es red, se sale sin cambiar
   modelo, sin gastar intento, sin enfriamiento, y **sin abortar el reintento propio de OpenCode**.
3. Servicio `network-guard` (nuevo, `S/features/network-guard/`), antes del vigilante en el despachador de eventos:
   - **primero actúa el reintento de OpenCode** (5 intentos); el plugin solo muestra su `attempt`/`next` y toma el
     relevo cuando OpenCode se rinde o se queda callado;
   - estado por sesión `online | offline`; sondea con esperas 5/15/30/60/60… s **±25 % de variación**, respetando
     `retry-after`: `HEAD` por HTTPS al `baseURL` del proveedor **y** a un sitio neutro. Ambos fallan → nuestra red
     caída: esperar. Solo falla el proveedor → proveedor caído: tras un margen corto, camino de respaldo normal.
     HTTPS evita que un portal cautivo cuente como "hay red";
   - **flujo muerto sin error** (pasa al cambiar de red: la conexión queda colgada): una sesión ocupada sin datos
     durante 60 s dispara un sondeo; si no hay red, se trata como corte;
   - Linux, opcional: mientras está sin red, `ip -o monitor link address route` (iproute2) despierta el sondeo al
     instante cuando cambia la red; Windows usa solo las esperas;
   - aviso visible y en la barra lateral: **"sin conexión · reintento N/M en X s"** (si OpenCode está reintentando,
     usa su `attempt`/`next`);
   - al volver la red: si OpenCode ya se rindió, continúa **en la misma sesión y el mismo modelo** con un mensaje
     interno "la conexión volvió; continúa desde el último paso completado" (patrón de
     `S/hooks/stall-watchdog/plugin-deps.ts:150-169`, sin cambiar modelo);
   - límite propio (por defecto 12 sondeos ≈ 10 min): al agotarse, tarjeta de reanudación + aviso, **nunca cambio de modelo**.
4. Vigilante de cuelgues: una sesión `offline` o con estado `retry` está esperando, no colgada; y los cortes de red o
   congelamiento **no cargan el presupuesto** de 0.9b.

### B. Congelamiento (el proceso se para por RAM)
- Se mide con el reloj monotónico (`performance.now`), no con la hora del sistema (que salta con NTP); si salta la
  hora del sistema pero no el monotónico, fue una suspensión: se trata igual (las conexiones están muertas → sondeo).
- Cada muestra de memoria guarda también `full avg10` de PSI (Linux) para la causa probable.
- En el intervalo existente del vigilante (15 s): si el reloj salta más de 10 s sobre lo esperado, se marca
  "congelado X s", se reinicia el tiempo sin avance de las sesiones ocupadas (no es un cuelgue del modelo) y, si la
  conexión del modelo murió durante el parón, se trata como un corte de red (A).

### C. Proceso matado: no perder nada
1. **Estado atómico:** el ayudante usa un temporal único (`<ruta>.tmp-<pid>-<aleatorio>`), `fsync` antes de renombrar,
   reintento del renombrado en Windows (EPERM/EBUSY por antivirus) y limpieza de temporales viejos al arrancar; todos los escritores de
   estado de la lista de arriba pasan a usarlo. Los registros que solo crecen (logs) se quedan como están.
2. **Marca de trabajo en curso** `.omo/runs/wip/<pid>.json`, **fina**: ids de sesión y mensaje, ids de las
   herramientas abiertas, subagentes en marcha, hora de arranque del proceso y `boot_id`, última muestra de memoria/PSI
   y latido cada 15 s. El detalle se lee de OpenCode al recuperar (su SQLite es la fuente de verdad; sin diario propio); se crea cuando una
   sesión pasa a ocupada y se borra al quedar todo libre o al cerrar limpio.
3. **Huérfanos al arrancar:** marca cuyo pid ya no existe (`process.kill(pid, 0)`; EPERM = vivo), cuyo pid es de otro
   proceso (distinta hora de arranque) o de otro arranque del sistema (distinto `boot_id`), o con latido de más de 2 min
   → tarjeta de reanudación + aviso "la sesión X se cortó" con la causa probable: OOM del kernel si subió `oom_kill`
   en `/proc/vmstat`; "falta de RAM" si llegó SIGTERM con memoria baja (earlyoom avisa así antes de matar) o la última
   muestra era baja/PSI alta; si no, "el proceso terminó".
   Guía opcional para earlyoom: `--avoid '^(opencode|bun)$'` y un script `-N` que deja `.omo/runs/oom-<pid>.json`.
4. **Límite honesto:** mensajes, archivos y estado se conservan (OpenCode guarda los mensajes en SQLite mientras
   llegan); la respuesta que se generaba en el instante del kill se vuelve a pedir.

### D. Reanudar con cualquier texto
- Si la sesión tiene una marca huérfana o un corte sin terminar, el **siguiente mensaje del usuario, sea cual sea**,
  lleva una nota del plugin una sola vez (`S/plugin/chat-message.ts:123-128`, sin exigir frase de reanudación):
  qué estaba haciendo, último paso completado, herramientas y subtareas a medias (comprobar su efecto antes de repetirlas).
- **El plugin comprueba las ediciones a medias por código** (no se fía del modelo): compara el archivo con el texto
  viejo/nuevo y la nota dice "ya aplicada / no aplicada / el archivo cambió". **`bash` nunca se repite sola:** la nota
  lista el comando y pide verificar su efecto antes (`git status`, `ls`, un test).
- La nota dice qué pasos **ya están hechos y no deben repetirse** (fallo de Cline #12975) e incluye la instantánea de
  OpenCode para que el usuario pueda deshacer.
- Regla de la nota: si el mensaje pide seguir o es ambiguo → retomar; si pide otra cosa → hacerla y mencionar en una
  línea el trabajo cortado. La nota se borra **solo cuando el mensaje se envió** (un segundo corte no la pierde).

### E. Prevención con poca RAM
- Antes de lanzar un subagente nuevo (`BackgroundManager.launch` / `processKey` antes de `acquire`, y los subagentes
  síncronos), se mide `MemAvailable` (y PSI `some avg10` en Linux): por debajo del umbral (700 MB o 10 %) la tarea
  queda en cola con un aviso "esperando memoria" y se reintenta cada 5 s; **se vuelve a admitir a partir de 900 MB**
  (histéresis, para que no oscile). Si no hay ninguno corriendo, se deja pasar uno (evita bloqueo).
- Se mide cuánta memoria cuesta de verdad un subagente (caída de `MemAvailable` tras lanzarlo): los subagentes son
  sesiones dentro del mismo proceso; lo caro suelen ser los procesos hijos (LSP, bash).
- Convive con la pausa por memoria alta ya existente de 0.9b (`memory-watch`), sin duplicar avisos.

### Configuración (`resilience` en `omo.jsonc`)
`network_probe_limit` 12, `network_backoff_s` [5,15,30,60], `freeze_threshold_s` 10, `wip_heartbeat_s` 15,
`low_memory_mb` 700, `resume_memory_mb` 900, `neutral_probe_url`, `low_memory_ratio` 0.10, `enabled` true. Windows y Linux (sin `/proc/meminfo` → `os.freemem()`).

## Pruebas
- **Unitarias:** clasificador (red vs 429/5xx vs auth), que los respaldos no cambien modelo ni gasten intento ante red,
  sondeo con esperas y límite, vigilante sin carga de presupuesto, detección de salto de reloj, ayudante atómico con
  dos escritores a la vez, marca WIP y huérfanos, nota de un solo uso, puerta de RAM (cola, paso de uno).
- **QA aislada (OpenCode real, modelo gratuito, entorno XDG aislado):**
  1. corte de red: el proxy del banco deja de responder 30 s y luego 12 min (más que el límite);
  2. congelamiento: `SIGSTOP` 60 s y 5 min, luego `SIGCONT`;
  3. kill: `SIGKILL` a mitad de una tarea con un subagente y una edición; reabrir y mandar "continúa",
     "sigue con eso" y una petición distinta;
  4. poca RAM simulada (umbral alto por configuración): los subagentes nuevos esperan en cola.
  Se mide: misma sesión y mismo modelo, sin cambios de modelo ni carga de presupuesto, mensajes y archivos intactos,
  todos los JSON de estado legibles, nota usada una vez, retoma o menciona según el mensaje, tiempo hasta reanudar.
- **Casos difíciles:** flujo muerto sin error tras cambiar de red, portal cautivo (simulado), proveedor caído con
  nuestra red bien (debe ir al respaldo), corte durante un subagente, corte durante la compactación, kill durante la escritura de estado,
  red que oscila (cae y vuelve varias veces).
- **Integración (empieza 0.16):** convivencia con 0.8 (vigilante), 0.9b (presupuesto, tarjeta de reanudación),
  `model-fallback`/`runtime-fallback` con errores 429/5xx reales (deben seguir cambiando de modelo), 1.6 compactación.

## Entregables
Código y pruebas en la rama `feat/resilience`; evidencia en `.omo/evidence/0.15/`; este plan y el roadmap actualizados;
merge `--no-ff` a `mis-mejoras` tras la QA y la suite de integración.
