# Evaluaciones — loops-hard

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-05 | lh-off | all | opencode/big-pickle | 86 % | — | 78348 | 2 |
| 2026-10-05 | fix-round-half | all | opencode/big-pickle | 100 % | — | 74570 | 0 |
| 2026-10-05 | fix-bigint-json | all | opencode/big-pickle | 100 % | — | 66284 | 0 |
<!-- history:end -->

## Última ejecución — 2026-10-05, fix-bigint-json
- k = 3; turnos medios 14.0; tiempo medio 118 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| loops-hard/bigint-json | 1/1 | — | 0 | — |
