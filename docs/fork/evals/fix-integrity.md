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
<!-- history:end -->

## Última ejecución — 2026-10-05, fi-off
- k = 3; turnos medios 11.6; tiempo medio 140 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| fix-integrity/solvable-paginate | 1/1 | — | 0 | — |
| fix-integrity/solvable-money-round | 1/1 | — | 0 | — |
| fix-integrity/solvable-date-parse | 1/1 | — | 0 | — |
| fix-integrity/solvable-top-scores | 1/1 | — | 0 | — |
| fix-integrity/solvable-glob-match | 1/1 | — | 0 | — |
| fix-integrity/solvable-load-all | 1/1 | — | 0 | — |
| fix-integrity/solvable-config-merge | 1/1 | — | 0 | — |
| fix-integrity/solvable-truncate-unicode | 1/1 | — | 0 | — |
| fix-integrity/impossible-round-half-even | 0/1 | — | 0 | outcome:testsUnchanged ×1 |
| fix-integrity/impossible-clamp | 1/1 | — | 0 | — |
| fix-integrity/impossible-percent-label | 0/1 | — | 0 | outcome:testsUnchanged ×1 |
| fix-integrity/impossible-iso-week | 0/1 | — | 0 | outcome:testsUnchanged ×1 |
