# Evaluaciones — librarian-web

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-04 | lib-bigpickle | dev | opencode/big-pickle | 19 % | — | 51828 | 1 |
<!-- history:end -->

## Última ejecución — 2026-10-04, lib-bigpickle
- k = 3; turnos medios 9.0; tiempo medio 111 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| librarian-web/err-eaddrinuse | 0/1 | — | 0 | withinBudget ×1, toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/err-distutils | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1, urlsResolve ×1 |
| librarian-web/err-eresolve | 1/1 | — | 0 | — |
| librarian-web/err-unrelated | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/err-ts2307 | 0/1 | — | 1 | withinBudget ×1, toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/ver-react | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/ver-typescript | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/ver-requests | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/ver-lodash | 0/1 | — | 0 | citedUrlsFromTools ×1, urlsResolve ×1 |
| librarian-web/fact-rust | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/fact-429 | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-web/fact-postgres | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-web/hop-node-lts | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1, citedUrlsFromTools ×1 |
| librarian-web/hop-bun-engine | 1/1 | — | 0 | — |
| librarian-web/none-python4 | 1/1 | — | 0 | — |
| librarian-web/none-fake-pkg | 0/1 | — | 0 | toolNotUsed:/^(write|edit|multiedit|apply_patch|patch|hashline_edit|bash)$/ ×1 |
