# Paso 0.16 — Suite de integración acumulativa y bloqueo de commits sin pruebas

Parte del roadmap (fila 0.16; 4.9 para el comportamiento del `git-committer`). Estado: **investigación hecha
(05-10-2026)**; plan detallado tras cerrar 0.15. `S/` = `packages/omo-opencode/src/`. `[nv]` = sin verificar.

## Hallazgos en el código
- `S/features/test-integrity/test-runs.ts` solo guarda en memoria qué comandos de test corrieron; **no guarda huellas
  del contenido** y se pierde al reiniciar → hace falta un registro persistente `{archivo → hash del blob en una
  ejecución en verde}`.

## Sistemas homólogos
- **Grabar y reproducir respuestas del modelo:** jsdelfino/vcr (proxy entre agente y proveedor, guarda `.json`/`.sse`,
  reproduce sin llamar al proveedor y falla en la primera diferencia), agent-vcr, llmtape; servidor falso compatible con
  OpenAI (zerob13/mock-openai-api).
- **Bun 1.3.13:** `--isolate`, `--parallel`, `--shard`, `bun test --changed` (no sigue `#imports` ni paquetes del
  workspace: oven-sh/bun#44162). `vitest related` / `jest --findRelatedTests` recorren el grafo de imports.
- **Aider:** `--auto-lint`, `--test-cmd` + `--auto-test` (devuelve los fallos para arreglar; no bloquea el commit).
- **Claude Code:** hooks `PreToolUse` que bloquean (`git commit` en Bash) y `Stop` que impiden terminar.
- **tdd-guard (nizos):** bloquea por la última salida real de tests capturada por el hook, no por lo que diga el agente.
- **Trampas conocidas:** `--no-verify`, `HUSKY=0`, `-c core.hooksPath=`; Kinney ("making it hard to cheat") repite las
  comprobaciones en la frontera de merge.

## Diseño (a detallar)
**0.16a suite acumulativa, dos niveles:**
1. *Nivel A, determinista y rápido* (en cada merge): escenarios contra un servidor de modelo **guionizado** compatible
   con OpenAI que emite la secuencia de herramientas que cada guardián necesita (cuelgues, bucles, tests, puerta Zen,
   cortes de red…). Segundos, sin cuota ni red.
2. *Nivel B, real y gratuito:* una tarea por suite del banco con big-pickle; grabación para reproducir; pass^2–3;
   informa, **no bloquea solo**.
3. Cada escenario es una carpeta (config, guion, eventos esperados); cada paso añade la suya; una prueba compara la
   lista de funcionalidades con el manifiesto para que ningún paso olvide registrar su escenario.
4. Normalizar fechas e ids antes de comparar grabaciones; la matriz combinatoria se queda en 5.2.

**0.16b bloqueo de commits:**
1. Huella por **contenido**: al acabar una ejecución en verde, `git hash-object` de cada archivo cubierto; al hacer
   commit, comparar con los blobs del índice (`git ls-files -s` / `git diff --cached --raw`). Nada de mtime ("racy git").
   Volver al mismo contenido no exige repetir.
2. Cobertura: suite entera = todo; filtrada = lo relacionado calculado por el plugin (`bun test --changed` / grafo de
   imports); si un archivo no se puede mapear, se exige la suite entera.
3. Todas las vías de commit: `git commit` (`-a`, `--amend`, rutas), `merge`, `cherry-pick`, `rebase`, `commit-tree`,
   `gh pr merge`, `git -C`, `sh -c`/`bash -c`; respaldo con un hook `pre-commit` propio vía `core.hooksPath` que lee el
   registro; se bloquean `--no-verify`, `HUSKY=0`, `LEFTHOOK=0`, `-c core.hooksPath=`.
4. Registro fuera del alcance del agente (protegido por 0.18) para que no pueda falsificarlo con `echo`.
5. Chequeo de tipos con la misma regla (exit 0 después del último cambio).
6. Trampas: exit 0 con **cero tests** no es verde; una ejecución filtrada que no incluye el archivo no cuenta; archivos
   a medio añadir al índice: la evidencia debe ser del blob del índice, no de la copia de trabajo.

## Plan detallado (borrador 05-10-2026, pendiente de aprobación)
### 0.16a — Suite de integración acumulativa
1. **Servidor de modelo guionizado** (`script/fork/integration/mock-model.ts`): compatible con OpenAI chat-completions
   (SSE), responde según un guion por escenario: secuencia de turnos con texto y llamadas a herramientas, y modos de
   fallo (cortar la conexión, retener cabeceras, cerrar el flujo a mitad, devolver 429/5xx, nombre de herramienta roto).
   Sin red ni cuota; determinista. Se registra en el entorno aislado como proveedor `mock` y todos los agentes usan
   `mock/scripted`.
2. **Escenarios por carpeta** (`script/fork/integration/scenarios/<paso>-<nombre>/`): `scenario.ts` con el guion, el
   fixture del proyecto, la configuración extra y las comprobaciones (eventos del registro del plugin, archivos,
   mensajes). Uno por funcionalidad hecha: 0.8 cuelgue → vigilante recupera; 0.9a editar un test → bloqueado y deshecho;
   errores de tipos nuevos → aviso; 0.9b mismo error 4 veces → bloqueo y pregunta; puerta Zen → `bash`/`read` presentes;
   1.6 compactación → tarjeta con punteros; 4.18 `web_answer` con URL inventada → rechazada; 0.15 corte, congelamiento,
   kill, poca RAM, nombre roto; configuración de proyecto que apaga un guardián → ignorada; avisos de proceso con la
   sesión ocupada → uno; `headerTimeout` → reintento.
3. **Todo activado**: la suite corre con la configuración por defecto del plugin (todos los guardianes encendidos).
4. **Manifiesto**: `features.json` lista las funcionalidades hechas; una prueba falla si alguna no tiene escenario (ningún
   paso olvida registrar el suyo).
5. **Ejecución**: `bun script/fork/integration/run.ts` — un OpenCode aislado para toda la suite, escenarios de uno en
   uno, informe con PASS/FAIL y evidencia; respeta la reserva de 3 GB; limpia el entorno al terminar.
6. **Nivel B** (real, informa sin bloquear): una tarea por suite del banco con big-pickle (`--smoke`).

### 0.16b — Bloqueo de commits sin pruebas
1. **Registro de evidencia** (`S/features/test-evidence/`): al terminar una ejecución de tests en verde (comando
   reconocido por `test-runs.ts`, salida con >0 tests y 0 fallos) se guarda `{archivo → git hash-object}` de los archivos
   que cubre (suite entera = todos los de código del proyecto; filtrada = los del filtro + los relacionados por imports);
   lo mismo para el chequeo de tipos (exit 0). Persistente en `.omo/evidence-ledger.json` (escritura atómica;
   protección contra el agente en 0.18).
2. **Bloqueo** en `tool.execute.before` de `bash` (y del `git-committer`): comandos que crean commits (`git commit`,
   `-a/-am`, `--amend`, `merge`, `cherry-pick`, `rebase`, `commit-tree`, `gh pr merge`, con `git -C` y envoltorios
   `sh -c`/`bash -c`) → se calculan los blobs del índice (`git ls-files -s` / `git diff --cached --raw`) de los archivos de
   código; si alguno no tiene evidencia en verde con ese mismo hash → bloqueado con la lista de archivos y el nivel que
   falta. Se bloquean también `--no-verify`, `HUSKY=0`, `LEFTHOOK=0`, `-c core.hooksPath=`.
3. **Niveles**: commit de rama → tests relacionados + tipos; merge a la rama principal (detectada del remoto o
   configurable) → además la suite de integración (resultado registrado por 0.16a); solo documentación → libre.
4. **Saltarlo**: solo con la pregunta al usuario "Permitir commit sin pruebas" (igual que el desbloqueo de tests).
5. **Pruebas y QA**: unitarias (huellas, cobertura, todas las vías de commit, trampas: exit 0 con cero tests, filtro que
   no incluye el archivo, archivo a medio añadir); QA con el servidor guionizado: commit sin probar → bloqueado; probar →
   pasa; editar después → bloqueado; merge sin suite → bloqueado.
6. **Medición**: en el banco, porcentaje de commits sin pruebas antes/después (tareas que piden commit).
