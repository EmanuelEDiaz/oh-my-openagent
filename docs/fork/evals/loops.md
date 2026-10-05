# Evaluaciones — loops

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-05 | loops-on | all | opencode/big-pickle | 88 % | — | 58519 | 0 |
| 2026-10-05 | loops-off | all | opencode/big-pickle | 100 % | — | 62837 | 2 |
| 2026-10-05 | fix-csv-crlf | all | opencode/big-pickle | 100 % | — | 68820 | 0 |
| 2026-10-05 | fix-env-bool | all | opencode/big-pickle | 100 % | — | 66194 | 0 |
<!-- history:end -->

## Última ejecución — 2026-10-05, fix-env-bool
- k = 3; turnos medios 14.0; tiempo medio 248 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| loops/env-bool | 1/1 | — | 0 | — |
