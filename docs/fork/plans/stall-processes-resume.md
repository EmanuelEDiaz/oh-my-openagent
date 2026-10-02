# Paso 0.8 — Diseño detallado: cuelgues, procesos en segundo plano y reanudación

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **aprobado (02-10-2026)**; **0.8a hecho**, sigue 0.8b.
Base: decisiones en `plans/robustness-fixes.md` (0.8) y `plans/bounded-retry-resume.md`. Rutas: `S/` =
`packages/omo-opencode/src/`. Todo funciona en Windows y Linux (0.11).

## Tres entregas, cada una con su rama, tests en rojo, QA aislada, merge y push

### 0.8a — Corte del streaming, vigilante, límites y aviso
1. **`chunkTimeout` por defecto** (hook `config`, `S/plugin-handlers/`):
   - para cada proveedor conectado o configurado sin `chunkTimeout`, se añade
     `provider.<id>.options.chunkTimeout = 90000`;
   - nunca se pisa un valor del usuario; se puede desactivar con `stall.chunk_timeout_ms: false`;
   - así el fallo lo produce la descarga (reintentable por OpenCode) en vez de un abort que puede bloquear el servidor.
2. **Vigilante de avance** (módulo nuevo `S/features/stall-watchdog/`):
   - marca de tiempo por sesión con cada `message.part.updated`/`delta`, `session.next.*` y `message.updated`;
   - cada 15 s revisa las sesiones ocupadas. Hay cuelgue si pasan **4 min sin avance**, sin ninguna herramienta en
     estado `running` y sin ningún proceso gestionado (0.8b) en marcha;
   - aborta con un tiempo límite y sin esperar dentro del hook. Si el servidor no responde, avisa y no insiste.
3. **Reintento acotado (presupuesto aprobado):**
   - 2 cuelgues en la misma tarea → parar;
   - reintento con el siguiente modelo de respaldo, reutilizando lo que ya existe:
     - delegación síncrona: `sync-task-fallback`;
     - segundo plano: `tryFallbackRetry`;
     - sesión principal: el reenvío de `runtime-fallback`;
   - un modelo con 5 fallos en 10 min se aparta 5 min.
4. **Aviso:**
   - en pantalla para el usuario;
   - al modelo: el resultado de la herramienta en la delegación síncrona ("`explore` se colgó 4 min con X;
     reintentado con Y"), una notificación en segundo plano, o un "continúa" interno en la sesión principal.
   - Al agotar el presupuesto, el trabajo se **pausa** (con 0.8c completo, con su tarjeta de reanudación; hasta
     entonces, con el motivo guardado).
5. ~~**Umbrales bajos donde ya existían** (45 → 10 min en segundo plano, 30 → 10 min en síncrona).~~ **Descartado
   al implementarlo (02-10-2026).** Esos temporizadores no distinguen una herramienta larga legítima (unos tests de
   15 min) de un cuelgue: con 10 min habrían cancelado trabajo válido, y un test del original lo detectó. Se quedan
   en 45 y 30 min como red de seguridad; el vigilante, que sí excluye las herramientas en marcha, actúa a los 4 min.

### Resultado de 0.8a (02-10-2026)
- **Hecho:**
  - `chunkTimeout` 90 s por defecto (`S/plugin-handlers/stall-chunk-timeout.ts`);
  - vigilante (`S/features/stall-watchdog/`, `S/hooks/stall-watchdog/`);
  - delegación síncrona y segundo plano reintentan con el siguiente modelo;
  - la sesión principal continúa con el respaldo;
  - presupuesto de 2 recuperaciones por tarea; configuración `stall`.
- **Encontrado y corregido durante la QA:**
  - **Fallo del original:** el respaldo por agente no encontraba la configuración cuando la sesión daba el nombre
    visible ("Sisyphus - ultraworker" frente a `sisyphus`); afectaba también a `runtime-fallback`
    (`hooks/runtime-fallback/fallback-models.ts`).
  - **"SSE read timed out"** (el corte de `chunkTimeout`) no se consideraba reintentable con otro modelo; ahora sí
    (`model-core/src/model-error-classifier.ts`).
  - **La sesión principal que termina con ese corte** tras los reintentos de OpenCode ahora continúa con el modelo de
    respaldo.
- **Descartado:** bajar los temporizadores antiguos a 10 min (ver punto 5).
- **QA aislada** con un proveedor simulado que se cuelga a demanda (evidencia en `.omo/evidence/0.8a/`):
  - A (sesión principal, vigilante a 60 s) → continúa con el respaldo y responde;
  - B (`chunkTimeout`) → "SSE read timed out", reintentos de OpenCode y, al agotarse, continúa con el respaldo;
  - C (subagente colgado en la delegación síncrona) → reintento con el respaldo y la tarea termina bien;
  - `opencode.db` y `auth.json` reales sin cambios.
- **Tests:**
  - 8822 del plugin en verde; 99 fallan solo en la ejecución conjunta (contaminación conocida) y los 13 archivos
    afectados pasan uno a uno;
  - tipado limpio.

### 0.8b — Procesos largos en segundo plano, obligatorios
1. **Herramientas** (se amplía `monitor`, que pasa a estar activado por defecto):
   - `process_start {name, command, cwd?, wait_for?: "exit" | {pattern} | {port}, timeout_ms?, keep_alive?}`;
   - `process_status`, `process_logs`, `process_list`, `process_stop`.
2. **Aviso al terminar:** cuando se cumple `wait_for`, la sesión recibe el resultado con el código de salida y las
   últimas líneas del log, sin gastar turnos mientras espera.
3. **Límites:**
   - tiempo máximo por proceso (por defecto 2 h, configurable); si se excede, **avisa al usuario** en vez de matarlo;
   - al cerrar la sesión, aviso de los procesos vivos; los `keep_alive` no se tocan.
4. **Parar de verdad:** `terminateProcessTree` (POSIX por grupo, Windows con `taskkill /T`). Solo dice "parado" si
   no sobrevive nada; si algo sobrevive, da el comando exacto para pararlo a mano. Registro en `.omo/processes.json`.
5. **Obligatorio por código** (`tool.execute.before` en `bash`):
   - se **bloquean** instalaciones (`npm/pnpm/yarn/bun/pip/uv/cargo/go install|add`, `apt`…), descargas
     (`curl -O`/`wget` de archivos), builds y contenedores (`docker build|pull|compose up`) y servidores o watchers
     (`dev`, `serve`, `watch`, `--watch`);
   - el mensaje dice exactamente cómo lanzarlo con `process_start`;
   - lista ampliable y desactivable por proyecto.
6. **Contra la autodestrucción** (del antiguo plan de procesos): se bloquean `pkill`/`killall` amplios, `pkill -f`
   cuyo patrón coincida con OpenCode o con el propio comando, `kill` de OpenCode o de sus ancestros, y
   `tmux kill-server`.
7. **Prompt:** regla explícita en todos los agentes que ejecutan comandos: "para procesos largos, `process_start` es
   obligatorio".

### 0.8c — Reanudación sin pérdidas (común con 0.9)
1. **Al pausar** (presupuesto agotado, parada del usuario o SIGTERM):
   - tarjeta `.omo/runs/<id>/RESUME.md` + `resume.json`, escritas de forma atómica;
   - cambios a medio hacer en `refs/omo/wip/<id>`;
   - trabajo `paused` en `boulder.json`.
2. **SIGTERM** (`earlyoom`, cierre): el plugin lo captura, guarda la tarjeta y la referencia WIP de las sesiones
   activas en menos de 1 s y deja salir al proceso.
3. **Vigilante de memoria:**
   - si la memoria del proceso de OpenCode pasa de un umbral, aviso ("sesión grande: compacta o abre otra; el estado
     ya está guardado") y guardado anticipado;
   - en Windows se lee con la API de Node, sin herramientas de Linux.
4. **`/omo-resume [id] [--model X] [--hint "..."]` + herramienta `resume_task`:**
   - lista los trabajos pausados y comprueba que los archivos coinciden con la referencia WIP;
   - arranca con la tarjeta, el diff, la pista y la lista de "intentos que no hay que repetir".
5. **Huecos cerrados:**
   - las sesiones de subagentes ligadas a trabajos pausados no se borran;
   - `/stop-continuation` pausa en vez de borrar;
   - `/handoff` guarda su resumen;
   - los contadores de Atlas y de la continuación de tareas se guardan en disco y avisan al usuario.
6. **Fugas de memoria:** medición con y sin el plugin en una sesión larga (índice de conocimiento, LSP, tareas en
   segundo plano, cachés); se corrige lo que sea del plugin.

## QA aislada (sin depender de que un modelo gratuito se cuelgue)
- **Proveedor simulado:** un servidor local compatible con OpenAI dentro del sandbox que emite unos tokens y **se
  queda callado**. Permite reproducir el cuelgue, el `chunkTimeout`, el vigilante y el reintento con el siguiente
  modelo de forma determinista.
- **Procesos:**
  - un comando largo bloqueado en `bash`;
  - un `process_start` con `wait_for` que despierta a la sesión;
  - un proceso con nieto que `process_stop` mata del todo.
- **SIGTERM:** enviar SIGTERM al OpenCode del sandbox a mitad de una tarea y comprobar que la tarjeta y la referencia
  WIP existen y que `/omo-resume` continúa.
- **Windows:** tests de las ramas `win32` (terminación, rutas, memoria) en el CI de Windows.

## Decisiones del usuario (02-10-2026)
- Orden de entrega: **0.8a → 0.8b → 0.8c**.
- Vigilante de memoria: **1,2 GB de OpenCode o 85 % de la RAM**, lo que llegue antes; configurable.
- Procesos en segundo plano: **2 h y aviso, sin matar**; configurable por proceso.
