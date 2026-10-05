# Evaluaciones — librarian-web

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-04 | lib-bigpickle | dev | opencode/big-pickle | 19 % | — | 51828 | 1 |
| 2026-10-04 | lib-holdout | holdout | opencode/big-pickle | 50 % | — | 33640 | 0 |
<!-- history:end -->

## Última ejecución — 2026-10-04, lib-holdout
- k = 3; turnos medios 2.8; tiempo medio 56 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| librarian-web/err-docker-sock | 0/1 | — | 0 | citedUrlsFromTools ×1, urlsResolve ×1 |
| librarian-web/ver-django | 1/1 | — | 0 | — |
| librarian-web/fact-python | 0/1 | — | 0 | citedUrlsFromTools ×1 |
| librarian-web/hop-deno | 1/1 | — | 0 | — |
