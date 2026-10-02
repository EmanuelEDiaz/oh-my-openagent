# Evaluaciones — explore

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-01 | baseline | dev | opencode/big-pickle | 100 % | 100 % | 10671 | 2 |
| 2026-10-02 | baseline explore actual (dev) | dev | opencode/big-pickle | 98 % | 94 % | 35352 | 11 |
<!-- history:end -->

## Última ejecución — 2026-10-02, baseline explore actual (dev)
- k = 3; turnos medios 6.9; tiempo medio 91 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| explore/retry-delay | 3/3 | 100 % | 0 | — |
| explore/api-token-readers | 3/3 | 100 % | 0 | — |
| explore/email-callers | 3/3 | 100 % | 0 | — |
| explore/fork-paid-model | 3/3 | 100 % | 1 | — |
| explore/fork-known-missing-callers | 3/3 | 100 % | 1 | — |
| explore/fork-compaction-flow | 2/2 | — | 4 | — |
| explore/fork-postgres | 2/3 | 0 % | 1 | citationsExist ×1 |
| explore/fork-lsp-timeout | 3/3 | 100 % | 0 | — |
| explore/codegen-generate-flow | 3/3 | 100 % | 0 | — |
| explore/codegen-plugin-discovery | 3/3 | 100 % | 1 | — |
| explore/codegen-dependency-rule | 3/3 | 100 % | 0 | — |
| explore/click-help-width | 3/3 | 100 % | 0 | — |
| explore/click-shell-completion-caller | 3/3 | 100 % | 0 | — |
| explore/click-version-flow | 3/3 | 100 % | 1 | — |
| explore/chi-insert-route | 3/3 | 100 % | 1 | — |
| explore/chi-request-flow | 3/3 | 100 % | 0 | — |
| explore/chi-websocket | 3/3 | 100 % | 1 | — |
