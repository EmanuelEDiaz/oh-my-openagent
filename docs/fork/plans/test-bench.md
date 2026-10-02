# Paso 3.0 — Banco de pruebas de agentes

Parte del roadmap: `docs/fork/roadmap.md`. Estado: **hecho (01-10-2026)**. Base: `plans/per-agent-program.md`.

## Qué debe hacer
Ejecutar tareas reales contra un OpenCode **aislado** con el plugin del fork y medir, para cada especialista y para el
sistema completo:
- si hizo bien la tarea, según el resultado real comprobado por código;
- si respetó su contrato (`<report>`, herramientas obligatorias usadas, prohibidas no usadas);
- si sus citas existen (`archivo:línea`, URL, versión de paquete);
- tokens, coste, tiempo, llamadas y turnos.

Repite cada tarea N veces y da `pass@1` y `pass^3`. No debe tocar nunca la configuración ni la base de datos reales.

## Hechos verificados que lo hacen posible
- El SDK permite enviar una parte `subtask` con `agent` y `prompt`
  (`@opencode-ai/sdk` v2, `SubtaskPartInput`). Así el especialista corre **como subagente de verdad**, igual que cuando
  lo delega el orquestador. Hay que evitar `opencode run --agent`, que con un subagente cae al agente por defecto.
- Cada mensaje del asistente trae `tokens {input, output, reasoning, cache}` y `cost`. Las partes `tool` traen nombre,
  entrada, estado y error. `session.children` da las sesiones hijas.
- Lecciones de las QA de este fork (roadmap, "Notas de QA"):
  - copiar antes `node_modules`/`package.json` de la config;
  - lanzar con `timeout -s KILL`;
  - el primer arranque de un sandbox tarda hasta ~6 min;
  - 403 intermitentes del plan gratuito;
  - modelos `*-free` de la caché que ya no existen;
  - borrar el sandbox, que contiene la copia de `auth.json`.

## Diseño
1. **Gestor de sandbox** (`script/fork/bench/sandbox.ts`):
   - crea el XDG aislado una sola vez y lo reutiliza entre tareas (evita repetir el arranque lento);
   - por tarea, copia un repo fijo de prueba a una carpeta temporal;
   - levanta un `opencode serve` y lo para matando su grupo de procesos;
   - al final borra todo, incluido `auth.json`.
2. **Formato de tarea** (`bench/tasks/<agente>/<id>.ts`, TypeScript para tipar los correctores):
   - `id`, `agent`;
   - `mode`: `subtask` (especialista) o `primary` (orquestador);
   - `fixture` (repo de prueba), `prompt`;
   - `expect`: lista de correctores;
   - `split`: `dev` | `holdout`;
   - `budget`: tokens, turnos y tiempo máximos.
3. **Correctores deterministas** comunes (`bench/graders.ts`):
   - `outcome`: comando o comprobación sobre el estado final del repo (tests pasan, archivo creado/sin tocar);
   - `contract`: `<report>` con Resumen/Resultado/Fuentes;
   - `toolUsed` / `toolNotUsed`;
   - `citationsExist`: `archivo:línea` contra el repo, URL con petición HEAD, paquete contra su registro;
   - `answerMatches`: regex sobre la respuesta;
   - `delegatedTo`: para orquestadores, en qué subagentes delegó (desde `session.children`).

   El juez LLM binario queda opcional y se valida contra etiquetas humanas antes de usarlo.
4. **Clasificación de fallos.** Un 403, un límite de uso o un turno colgado es **fallo de infraestructura**: se reintenta
   hasta 2 veces y **no** cuenta como fallo del agente. Solo cuentan los fallos de la tarea.
5. **Resultados:**
   - datos crudos en `.omo/evals/<fecha>-<agente>.jsonl` (local, no se versiona: incluye transcripciones);
   - resumen versionado en `docs/fork/evals/<agente>.md`: pass@1, pass^3, tokens y tiempo medios, citas inventadas,
     categorías de fallo y comparación con la medición anterior.
6. **CLI**: `bun script/fork/bench/run.ts --agent explore [--split dev|holdout|all] [--repeat 3] [--model …] [--smoke]`.
7. **Modelos** (decisión del usuario, 01-10-2026): el banco usa **los modelos que estén configurados con `/omo-models`**
   en ese momento y debe funcionar con **cualquier** proveedor o modelo, como OpenCode.
   - Se copia esa configuración al sandbox; `--model` solo la sobrescribe para un experimento puntual.
   - Cada resultado registra el modelo **resuelto de verdad** por agente, leído de los mensajes de la sesión. Una
     comparación solo es válida entre ejecuciones con los mismos modelos, y el informe avisa si no lo son.
   - No se arranca ningún servidor de modelos local: si el usuario lo tiene configurado y en marcha, se usa como
     cualquier otro.

## Decisiones que necesito
- **D1 — Motor**: resuelta → **banco propio en Bun**.
  - Con promptfoo, el sandbox, la ejecución como subagente, los correctores de herramientas y citas y la clasificación
    de fallos se escriben igual.
  - promptfoo solo aportaba visor web y matriz de modelos, a cambio de una dependencia de 32 MB y una caché que con
    agentes hay que desactivar. Además, su paralelismo no sirve con los límites de uso.
  - Descartados: evalite y vitest-evals (exigen Vitest además de `bun:test`; evalite trae un módulo nativo y aún no es
    1.0); Braintrust y LangSmith (servicios de pago o en la nube).
  - Inspect AI (Python + Docker) queda como opción para la Fase 5.
- **D2 — Modelos**: resuelta → los de `/omo-models`, agnóstico de proveedor (ver Diseño 7).

## Hallazgos al construirlo
- **La parte `subtask`** (OpenCode v1.18.26, `session/prompt.ts`, `handleSubtask`):
  - ejecuta el `task` real con `bypassAgentCheck` y pasa por los hooks del plugin;
  - al terminar, el agente principal hace un turno más. El banco espera a que termine la tarea hija y aborta la sesión
    padre, así no se gasta ese turno ni el orquestador sigue trabajando.
- **La guarda del sandbox** cubre tanto las rutas XDG por defecto como las que fije el entorno. Antes, un `XDG_*`
  redefinido dejaba sin protección `~/.local/share/opencode`.
- **El sandbox carga solo el plugin a probar** y `~/.omo/omo.jsonc` (modelos de `/omo-models`). No se copian los MCP
  ni las `instructions` del usuario, para que las mediciones sean reproducibles.
- **Versión de paquete en las citas**: se aplaza a 4.2/4.10, cuando `librarian`/`dependency-check` fijen cómo la
  citan. 3.0 comprueba `archivo:línea` y URL.

## Subtareas
- [x] 1. Tests de los correctores (con transcripciones de ejemplo, sin modelo) y del clasificador de fallos.
- [x] 2. Gestor de sandbox: reutilizable, limpieza garantizada aunque falle, calentamiento de la caché del plugin.
- [x] 3. Ejecutor:
  - modos `subtask` y `primary`, repeticiones, presupuestos;
  - reintentos de infraestructura y detección de estancamiento (240 s sin avance);
  - reinicio del servidor si deja de responder.
- [x] 4. Informe: `jsonl` local, resumen `md` y `regrade.ts`, que vuelve a puntuar sin llamar al modelo.
- [x] 5. Piloto: 3 tareas de `explore` × 3 repeticiones, ejecutadas de verdad.
- [x] 6. Docs, evidencia, merge y push; sandbox limpiado.

## Resultado del piloto (01-10-2026, `docs/fork/evals/explore.md`)
- **`explore` con `big-pickle`** (sus modelos configurados están retirados; ver 0.7):
  - 9/9: pass@1 100 %, pass^3 100 %;
  - ~10,7k tokens, 6,6 turnos y 83 s de media.
- **Las tareas piloto son fáciles.** En 4.1 se amplían a 15–30, con un conjunto reservado, para que la medición
  distinga mejoras.
- **Lo que el piloto enseñó del propio banco** (todo corregido, con test):
  - Los modelos gratuitos se cuelgan a mitad sin error: 4 cuelgues en 13 intentos en total. Ahora se detectan por
    falta de avance y se reintentan como infraestructura.
  - Tras un cuelgue, el servidor de OpenCode llegó a dejar de responder. Ahora se comprueba antes de cada tarea, se
    reinicia si hace falta, y un fallo al crear la sesión cuenta como infraestructura.
  - El corrector de citas daba por inventadas citas correctas: `retry.ts:4` sin carpeta, `http/client.ts` relativa
    a `src/` y `/…/src/config.ts` abreviada. Ahora se resuelven contra el repo; una ruta que no existe sigue
    fallando.
  - Hace falta calentar la caché de proveedores del plugin. Sin ella, cada tarea era un primer arranque.
- **Aislamiento:**
  - `opencode.db` y `auth.json` reales sin cambios;
  - los logs de OpenCode guardados en `.omo/evals/` sin ninguna clave;
  - evidencia en `.omo/evidence/3.0/`.

## Ampliaciones (02-10-2026, durante 4.1)
- **Repos fijados por commit o etiqueta** (`fixtures.ts`): repos locales sin su árbol de trabajo, y públicos
  (click 8.2.2, chi v5.3.2), extraídos una vez a `.omo/bench-cache/`. Incluye la copia de `codegenerator`.
- **Correctores nuevos:**
  - `citesLine`: cita el archivo en el rango correcto;
  - `saysAbsent`: responde "no existe" en vez de inventar.
- **Correctores afinados con respuestas reales**, sin dejar de detectar citas inventadas (comprobado con un caso
  real):
  - rutas sin carpeta o abreviadas (`.../`, `…/`);
  - código citado en bloques;
  - rutas de ejecución (`~/`, `<dataDir>/`);
  - ejemplos ("e.g.");
  - rutas que el repo contiene como texto;
  - archivos propuestos en `<next_steps>`.
- **`--resume <archivo>`:** continúa una medición rota sin repetir lo ya puntuado. `regrade.ts` vuelve a puntuar
  sin llamar al modelo.
- **Disco:**
  - cada carpeta de trabajo se borra al puntuarla;
  - OpenCode sin instantáneas en el sandbox (`snapshot: false`);
  - motivo: un repo grande llenó el `/tmp` en RAM.
- **Memoria:** `earlyoom` del sistema mata al servidor del sandbox cuando falta RAM (7 veces el 02-10). El banco lo
  ve como "servidor sin respuesta", lo reinicia y reintenta; no cuenta contra el agente.
- **Windows:** el banco es una herramienta de desarrollo y puede exigir Linux, WSL o Git Bash (decisión 0.11).

## Criterios de aceptación
```gherkin
Feature: banco de pruebas
  Scenario: un especialista corre como subagente de verdad
    When el banco ejecuta una tarea de modo subtask para "explore"
    Then la sesión hija la ejecuta el agente "explore" (no el agente por defecto)

  Scenario: citas comprobadas por código
    Given una respuesta que cita "src/a.ts:999" en un archivo de 3 líneas
    Then el corrector citationsExist la marca como cita inventada

  Scenario: la infraestructura no cuenta como fallo del agente
    Given un 403 del proveedor en la primera repetición
    Then se reintenta y el informe lo cuenta como fallo de infraestructura, no de la tarea

  Scenario: nunca toca lo real
    When el banco termina (o falla a mitad)
    Then no queda sandbox ni copia de auth.json, y opencode.db real no ha cambiado
```
