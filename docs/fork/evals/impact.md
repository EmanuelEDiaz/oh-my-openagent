# Evaluaciones — impact

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-28 | baseline | dev | opencode/big-pickle, opencode/deepseek-v4.1-flash-free | 100 % | 100 % | 40116 | 1 |
| 2026-10-28 | baseline-holdout | holdout | opencode/deepseek-v4.1-flash-free | 100 % | 100 % | 39538 | 0 |
<!-- history:end -->

> **Aviso:** la última ejecución usó modelos distintos que la anterior (opencode/big-pickle, opencode/deepseek-v4.1-flash-free → opencode/deepseek-v4.1-flash-free); no son comparables.

## Última ejecución — 2026-10-28, baseline-holdout
- k = 3; turnos medios 11.2; tiempo medio 75 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| impact/simple-status-filter | 3/3 | 100 % | 0 | — |
| impact/hard-token-from-config | 3/3 | 100 % | 0 | — |
