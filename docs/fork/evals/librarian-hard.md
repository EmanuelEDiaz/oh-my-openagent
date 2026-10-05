# Evaluaciones — librarian-hard

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-04 | libh | all | opencode/big-pickle | 20 % | — | 40752 | 2 |
<!-- history:end -->

## Última ejecución — 2026-10-04, libh
- k = 3; turnos medios 4.4; tiempo medio 85 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| librarian-hard/opencode-release | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-hard/bun-release | 0/1 | — | 0 | answerHasLive:bun date ×1 |
| librarian-hard/node-lts | 0/1 | — | 1 | citedUrlsFromTools ×1 |
| librarian-hard/zod-date | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-hard/ai-sdk-compat | 1/1 | — | 0 | — |
| librarian-hard/zen-freetier-issue | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-hard/zen-gate-tools | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-hard/bun-mock-scope | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-hard/none-maintainer | 0/1 | — | 0 | saysNotFound ×1 |
| librarian-hard/none-node-30 | 1/1 | — | 1 | — |
