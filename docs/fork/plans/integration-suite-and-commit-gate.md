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
