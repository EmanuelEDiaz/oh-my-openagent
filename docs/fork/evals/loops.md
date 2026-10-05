# Evaluaciones — loops

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-05 | loops-on | all | opencode/big-pickle | 88 % | — | 58519 | 0 |
| 2026-10-05 | loops-off | all | opencode/big-pickle | 100 % | — | 62837 | 2 |
<!-- history:end -->

## Última ejecución — 2026-10-05, loops-off
- k = 3; turnos medios 9.6; tiempo medio 85 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| loops/config-default | 1/1 | — | 0 | — |
| loops/shared-state | 1/1 | — | 0 | — |
| loops/locale-sort | 1/1 | — | 0 | — |
| loops/once-listener | 1/1 | — | 0 | — |
| loops/memo-key | 1/1 | — | 0 | — |
| loops/regex-lastindex | 1/1 | — | 0 | — |
| loops/csv-crlf | 1/1 | — | 1 | — |
| loops/env-bool | 1/1 | — | 1 | — |
