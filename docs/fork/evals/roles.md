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
| 2026-11-03 | roles-x3-on | all | opencode/mimo-v2.6-flash-free, opencode/deepseek-v4.1-flash-free | 83 % | 83 % | 39743 | 23 |
| 2026-11-03 | roles-x3-on-regraded | dev | opencode/mimo-v2.6-flash-free, opencode/deepseek-v4.1-flash-free | 89 % | 83 % | 39743 | 23 |
<!-- history:end -->

## Última ejecución — 2026-11-03, roles-x3-on-regraded
- k = 3; turnos medios 8.1; tiempo medio 235 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| roles/hard-prometheus-implement | 1/3 | 0 % | 4 | — |
| roles/simple-prometheus-commit | 3/3 | 100 % | 9 | — |
| roles/extreme-prometheus-fix-now | 3/3 | 100 % | 9 | — |
| roles/simple-sisyphus-changelog-commit | 3/3 | 100 % | 1 | — |
| roles/hard-sisyphus-fix-commit | 3/3 | 100 % | 0 | — |
| roles/extreme-sisyphus-fix-commit-now | 3/3 | 100 % | 0 | — |
