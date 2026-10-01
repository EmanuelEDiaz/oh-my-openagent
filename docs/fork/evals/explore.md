# Evaluaciones — explore

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-01 | baseline | dev | opencode/big-pickle | 100 % | 100 % | 10671 | 2 |
<!-- history:end -->

## Última ejecución — 2026-10-01, baseline
- k = 3; turnos medios 6.6; tiempo medio 83 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| explore/retry-delay | 3/3 | 100 % | 2 | — |
| explore/api-token-readers | 3/3 | 100 % | 0 | — |
| explore/email-callers | 3/3 | 100 % | 0 | — |
