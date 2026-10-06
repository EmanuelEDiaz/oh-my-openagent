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
| 2026-10-06 | smoke-nemotron-3.5-lightning-free | all | opencode/nemotron-3.5-lightning-free | 100 % | — | 104612 | 0 |
| 2026-10-06 | smoke-ling-3.1-flash-free | all | opencode/ling-3.1-flash-free | 100 % | — | 40709 | 0 |
| 2026-10-06 | lh-off-nemotron-3.5-lightning-free | all | opencode/nemotron-3.5-lightning-free | 86 % | — | 79198 | 0 |
<!-- history:end -->

> **Aviso:** la última ejecución usó modelos distintos que la anterior (opencode/ling-3.1-flash-free → opencode/nemotron-3.5-lightning-free); no son comparables.

## Última ejecución — 2026-10-06, lh-off-nemotron-3.5-lightning-free
- k = 3; turnos medios 13.4; tiempo medio 263 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| loops-hard/stale-shadow | 1/1 | — | 0 | — |
| loops-hard/codegen-preload | 1/1 | — | 0 | — |
| loops-hard/wrapper-rethrow | 0/1 | — | 0 | outcome:hiddenTests ×1 |
| loops-hard/round-half | 1/1 | — | 0 | — |
| loops-hard/tz-month | 1/1 | — | 0 | — |
| loops-hard/bigint-json | 1/1 | — | 0 | — |
| loops-hard/shallow-defaults | 1/1 | — | 0 | — |
