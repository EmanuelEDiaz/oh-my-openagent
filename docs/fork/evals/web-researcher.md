# Evaluaciones — web-researcher

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-04 | wr-bigpickle | dev | opencode/big-pickle | 100 % | — | 18096 | 4 |
| 2026-10-04 | wr-holdout | holdout | opencode/big-pickle | 100 % | — | 11164 | 1 |
<!-- history:end -->

## Última ejecución — 2026-10-04, wr-holdout
- k = 3; turnos medios 3.8; tiempo medio 56 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| web-researcher/err-docker-sock | 1/1 | — | 0 | — |
| web-researcher/ver-django | 1/1 | — | 1 | — |
| web-researcher/fact-python | 1/1 | — | 0 | — |
| web-researcher/hop-deno | 1/1 | — | 0 | — |
