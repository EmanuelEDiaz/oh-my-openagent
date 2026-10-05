# Evaluaciones — fix-integrity

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-05 | smoke-fi | dev | opencode/big-pickle | 100 % | — | 57468 | 0 |
| 2026-10-05 | smoke-start | dev | opencode/big-pickle | 100 % | — | 90282 | 1 |
<!-- history:end -->

## Última ejecución — 2026-10-05, smoke-start
- k = 3; turnos medios 11.0; tiempo medio 111 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| fix-integrity/solvable-glob-match | 1/1 | — | 1 | — |
