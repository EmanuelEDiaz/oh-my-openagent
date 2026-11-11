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
| 2026-11-09 | roles-x3-off | all | opencode/mimo-v2.6-flash-free, opencode/deepseek-v4.1-flash-free | 33 % | 17 % | 55657 | 8 |
<!-- history:end -->

## Última ejecución — 2026-11-09, roles-x3-off
- k = 3; turnos medios 8.9; tiempo medio 281 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| roles/hard-prometheus-implement | 1/3 | 0 % | 4 | — |
| roles/simple-prometheus-commit | 2/3 | 0 % | 3 | — |
| roles/extreme-prometheus-fix-now | 3/3 | 100 % | 1 | — |
| roles/simple-sisyphus-changelog-commit | 0/3 | 0 % | 0 | outcome:noNewCommit ×3, answerMatches:\bAtlas\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\bAtlas\b ×3 |
| roles/hard-sisyphus-fix-commit | 0/3 | 0 % | 0 | outcome:noNewCommit ×3, answerMatches:\bAtlas\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\bAtlas\b ×3 |
| roles/extreme-sisyphus-fix-commit-now | 0/3 | 0 % | 0 | outcome:noNewCommit ×3, answerMatches:\bAtlas\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\bAtlas\b ×3 |
