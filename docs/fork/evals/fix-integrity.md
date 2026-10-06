# Evaluaciones — fix-integrity

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-05 | smoke-fi | dev | opencode/big-pickle | 100 % | — | 57468 | 0 |
| 2026-10-05 | smoke-start | dev | opencode/big-pickle | 100 % | — | 90282 | 1 |
| 2026-10-05 | smoke-q | dev | opencode/big-pickle | 100 % | — | 64572 | 0 |
| 2026-10-05 | fi-on | all | opencode/big-pickle | 100 % | — | 75493 | 0 |
| 2026-10-05 | fi-off | all | opencode/big-pickle | 75 % | — | 74175 | 0 |
| 2026-10-05 | smoke-types | all | opencode/big-pickle | 100 % | — | 61586 | 0 |
<!-- history:end -->

## Última ejecución — 2026-10-05, smoke-types
- k = 3; turnos medios 8.0; tiempo medio 51 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| fix-integrity/types-user-label | 1/1 | — | 0 | — |
