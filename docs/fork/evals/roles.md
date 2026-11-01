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
<!-- history:end -->

## Última ejecución — 2026-11-01, roles-dev-off
- k = 3; turnos medios 7.3; tiempo medio 290 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| roles/hard-prometheus-implement | 0/1 | — | 0 | answerMatches:\b(Atlas|Sisyphus|Hephaestus)\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\b(Atlas|Sisyphus|Hephaestus)\b|\/ulw-execute\b ×1 |
| roles/simple-prometheus-commit | 0/1 | — | 0 | answerMatches:\b(Atlas|Sisyphus|Hephaestus)\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\b(Atlas|Sisyphus|Hephaestus)\b|\/ulw-execute\b ×1 |
| roles/simple-sisyphus-changelog-commit | 0/1 | — | 0 | outcome:noNewCommit ×1, answerMatches:\bAtlas\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\bAtlas\b ×1 |
| roles/hard-sisyphus-fix-commit | 0/1 | — | 0 | outcome:noNewCommit ×1, answerMatches:\bAtlas\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\bAtlas\b ×1 |
