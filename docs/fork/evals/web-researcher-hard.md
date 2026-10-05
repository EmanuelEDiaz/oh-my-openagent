# Evaluaciones — web-researcher-hard

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-04 | wrh | all | opencode/big-pickle | 50 % | — | 14589 | 2 |
<!-- history:end -->

## Última ejecución — 2026-10-04, wrh
- k = 3; turnos medios 5.7; tiempo medio 121 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| web-researcher-hard/opencode-release | 0/1 | — | 0 | answerHasLive:opencode date ×1 |
| web-researcher-hard/bun-release | 1/1 | — | 0 | — |
| web-researcher-hard/node-lts | 0/1 | — | 0 | answerHasLive:node lts ×1 |
| web-researcher-hard/zod-date | 1/1 | — | 0 | — |
| web-researcher-hard/ai-sdk-compat | 1/1 | — | 0 | — |
| web-researcher-hard/zen-freetier-issue | 0/1 | — | 1 | answerMatches:52907 ×1 |
| web-researcher-hard/zen-gate-tools | 0/1 | — | 0 | urlsResolve ×1, answerMatches:\bread\b&\bbash\b|\bshell\b&51315|51241|50627 ×1 |
| web-researcher-hard/bun-mock-scope | 1/1 | — | 1 | — |
| web-researcher-hard/none-maintainer | 0/1 | — | 0 | saysNotFound ×1 |
| web-researcher-hard/none-node-30 | 1/1 | — | 0 | — |
