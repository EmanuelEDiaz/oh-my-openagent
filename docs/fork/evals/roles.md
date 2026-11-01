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
<!-- history:end -->

## Última ejecución — 2026-11-01, sisyphus-off-smoke
- k = 3; turnos medios 10.0; tiempo medio 55 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| roles/hard-sisyphus-fix-commit | 0/1 | — | 0 | outcome:noNewCommit ×1, answerMatches:\bAtlas\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\bAtlas\b ×1 |
