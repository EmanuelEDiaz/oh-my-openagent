# Evaluaciones — roles

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-11-01 | roles-on-smoke | dev | opencode/mimo-v2.6-flash-free | 0 % | — | 38034 | 0 |
| 2026-11-01 | sisyphus-on-smoke | dev | opencode/deepseek-v4.1-flash-free | 0 % | — | 33389 | 0 |
| 2026-11-01 | sisyphus-off-smoke | dev | opencode/deepseek-v4.1-flash-free | 0 % | — | 35476 | 0 |
| 2026-11-01 | sisyphus-on-v2 | dev | opencode/deepseek-v4.1-flash-free | 100 % | — | 41634 | 0 |
| 2026-11-01 | sisyphus-off-v2 | dev | opencode/deepseek-v4.1-flash-free | 100 % | — | 21782 | 0 |
| 2026-11-01 | sisyphus-off-v3 | dev | opencode/deepseek-v4.1-flash-free | 0 % | — | 117704 | 0 |
| 2026-11-01 | roles-dev-on | dev | opencode/mimo-v2.6-flash-free, opencode/deepseek-v4.1-flash-free | 75 % | — | 29892 | 0 |
| 2026-11-01 | roles-dev-off | dev | opencode/mimo-v2.6-flash-free, opencode/deepseek-v4.1-flash-free | 0 % | — | 36123 | 0 |
| 2026-11-01 | h51-qa | dev | opencode/mimo-v2.6-flash-free | 100 % | — | 29877 | 0 |
<!-- history:end -->

> **Aviso:** la última ejecución usó modelos distintos que la anterior (opencode/mimo-v2.6-flash-free, opencode/deepseek-v4.1-flash-free → opencode/mimo-v2.6-flash-free); no son comparables.

## Última ejecución — 2026-11-01, h51-qa
- k = 3; turnos medios 7.0; tiempo medio 166 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| roles/simple-prometheus-commit | 1/1 | — | 0 | — |
