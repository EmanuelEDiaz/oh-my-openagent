# Reintentos limitados y reanudación sin pérdidas (común a 0.8 y 0.9)

Parte del roadmap: `docs/fork/roadmap.md` (pasos 0.8 y 0.9). Estado: **decidido (02-10-2026)**.
Rutas: `S/` = `packages/omo-opencode/src/`, `BS/` = `packages/boulder-state/src/`.

## Requisito del usuario (02-10-2026)
- Nada se reintenta para siempre.
- Tras unos pocos intentos se para y **se avisa al usuario**.
- Lo que se estaba haciendo se puede **reanudar sin pérdidas**.

## Hechos (verificado en el código y en las fuentes)
- **El plugin ya tiene límites, pero solo los registra en el log:** Atlas (3 sin avance), la continuación de tareas
  pendientes (3 estancamientos) y `runtime_fallback` (3).
  - El estado es solo en memoria.
  - No se avisa al usuario.
  - El trabajo sigue `active`.
- **Persistente hoy:** `.omo/boulder.json` (trabajos, sesiones de cada tarea del plan), las casillas del plan,
  `.omo/notepads`, el ledger y `opencode.db`.
- **Riesgos de pérdida:**
  - `/stop-continuation` **borra** `boulder.json` (`S/plugin/stop-continuation.ts`);
  - las sesiones de subagentes se borran a los 10 min de terminar (`TASK_CLEANUP_DELAY_MS`);
  - la reanudación de tareas en segundo plano depende de un registro en memoria;
  - `/handoff` no se guarda;
  - no se guardan los cambios a medio hacer.
- **`buildCompactionSnapshot` (1.6)** ya da peticiones literales, decisiones, archivos cambiados y errores de
  cualquier sesión.
- **Fuera:**
  - Google SRE: máximo 3 intentos y que reintente una sola capa;
  - circuit breaker (cerrado / abierto / semiabierto);
  - Anthropic ("effective harnesses for long-running agents") y Chroma ("context rot"): reanudar con una tarjeta
    enfocada supera repetir la conversación;
  - OpenCode reintenta 5 veces los errores del proveedor (`session/retry.ts`) y permite continuar una sesión,
    pero no un turno abortado.

## Decisiones del usuario (02-10-2026)
- **Presupuesto (todo configurable):**
  - errores del proveedor: los 5 de OpenCode + 1 reintento del plugin con el mismo modelo + 1 con el respaldo →
    parar;
  - cuelgues: 2 → parar;
  - bucles de errores: 2 / 3 / 4 (0.9);
  - tope de 6 intentos por tarea entre todos los subagentes;
  - un modelo con 5 fallos en 10 min se aparta 5 min y luego se prueba de nuevo.
- **Cambios a medio hacer:** referencia oculta de git: `git stash create` + `git update-ref refs/omo/wip/<id>`.
  - No crea commits, no toca el historial ni los archivos y no necesita identidad de git.
  - Se borra al terminar el trabajo.

## Diseño
1. **Al llegar al límite:**
   - el trabajo pasa a `paused` en `boulder.json` con `stalled_reason`, `attempts` y `last_error`;
   - se escribe la tarjeta `.omo/runs/<id>/RESUME.md` + `resume.json`, de forma atómica, con:
     - las peticiones literales del usuario;
     - el plan y el paso actual;
     - las decisiones y lo descartado;
     - los archivos cambiados y `diff --stat`;
     - la referencia WIP;
     - el último error normalizado con cada intento y su modelo;
     - las sesiones;
     - la siguiente acción.
2. **Aviso:**
   - mensaje en pantalla + notificación de escritorio;
   - el orquestador recibe la orden de preguntar con opciones: reintentar con otro modelo / dar una pista / saltar
     el paso / abortar.
3. **Reanudar** (`/omo-resume [id] [--model X] [--hint "..."]` + herramienta `resume_task`):
   - sin id, lista los trabajos pausados;
   - comprueba que los archivos coinciden con la referencia WIP y avisa si no;
   - reinicia el presupuesto del intento sin superar el tope por tarea;
   - el agente arranca con la tarjeta, el diff, la pista y "no repitas estos intentos: …", sin repetir toda la
     conversación;
   - funciona tras cerrar OpenCode.
4. **Huecos que se cierran:**
   - las sesiones de subagentes de un trabajo pausado no se borran;
   - `/stop-continuation` pausa en vez de borrar;
   - `/handoff` guarda su resumen en `.omo/runs/`;
   - los contadores se guardan en disco.

## Cierres por memoria (hallado 02-10-2026, decisiones del usuario)
- **Causa encontrada:** `earlyoom` (vigilante del sistema) envía **SIGTERM** al proceso que más memoria usa cuando la
  RAM disponible baja del 10 % y la swap se agota. En un PC de 7,5 GB, un OpenCode con una conversación larga
  (1–1,3 GB) es la víctima habitual.
  - Explica los cierres repentinos que el usuario ha sufrido; no se puede confirmar en el pasado porque el journal no
    es persistente.
  - Hoy mató 7 veces a los OpenCode del banco de pruebas: varios "servidor no responde" eran esto.
- **Decidido:**
  - **guardar al recibir SIGTERM:** el plugin captura la señal y escribe al instante la tarjeta de reanudación y la
    referencia WIP antes de salir, para que un cierre no pierda nada;
  - **vigilante de memoria:** si OpenCode pasa de un umbral configurable, avisa ("sesión grande: compacta o abre una
    nueva; el estado ya está guardado") y guarda el estado por adelantado;
  - **investigar fugas:** medir cuánto crece OpenCode con y sin el plugin en sesiones largas (índice de conocimiento,
    LSP, tareas en segundo plano, cachés) y corregir lo que sea del plugin.
- Ajustar `earlyoom`/swap queda en manos del usuario (requiere sudo); no se documenta por ahora.
- Para confirmar un cierre: `journalctl -b | grep earlyoom` justo después.

## Criterios de aceptación
```gherkin
Feature: reintentos limitados y reanudación
  Scenario: nunca infinito
    Given un subagente que falla siempre
    Then tras el presupuesto el trabajo queda pausado y el usuario recibe aviso con opciones
  Scenario: sin pérdidas
    Given un trabajo pausado con cambios a medio hacer
    When el usuario cierra OpenCode y luego ejecuta /omo-resume
    Then los cambios siguen recuperables por refs/omo/wip y el agente continúa desde el paso pendiente sin repetir los intentos fallidos
  Scenario: cierre por memoria
    When earlyoom envía SIGTERM a OpenCode durante una tarea
    Then antes de salir queda escrita la tarjeta de reanudación y /omo-resume continúa sin pérdidas
  Scenario: stop no destruye
    When el usuario ejecuta /stop-continuation
    Then el trabajo queda pausado y reanudable
```
