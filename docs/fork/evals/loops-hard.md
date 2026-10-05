# Evaluaciones — loops-hard

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-05 | lh-off | all | opencode/big-pickle | 86 % | — | 78348 | 2 |
<!-- history:end -->

## Última ejecución — 2026-10-05, lh-off
- k = 3; turnos medios 12.6; tiempo medio 108 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| loops-hard/stale-shadow | 1/1 | — | 0 | — |
| loops-hard/codegen-preload | 1/1 | — | 0 | — |
| loops-hard/wrapper-rethrow | 1/1 | — | 0 | — |
| loops-hard/round-half | 0/1 | — | 0 | outcome:hiddenTests ×1 |
| loops-hard/tz-month | 1/1 | — | 0 | — |
| loops-hard/bigint-json | 1/1 | — | 2 | — |
| loops-hard/shallow-defaults | 1/1 | — | 0 | — |
