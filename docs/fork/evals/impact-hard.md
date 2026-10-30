# Evaluaciones — impact-hard

Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en
`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.

## Historial
<!-- history:start -->
| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |
|---|---|---|---|---|---|---|---|
| 2026-10-29 | calibration | all | opencode/deepseek-v4.1-flash-free | 88 % | — | 82819 | 0 |
<!-- history:end -->

## Última ejecución — 2026-10-29, calibration
- k = 3; turnos medios 16.6; tiempo medio 139 s.

| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |
|---|---|---|---|---|
| impact-hard/hard-delivery-date | 1/1 | — | 0 | — |
| impact-hard/extreme-api-amount | 1/1 | — | 0 | — |
| impact-hard/hard-remove-discount | 1/1 | — | 0 | — |
| impact-hard/extreme-rename-resource | 1/1 | — | 0 | — |
| impact-hard/extreme-currency | 0/1 | — | 0 | outcome:noNewTypeEscapes ×1 |
| impact-hard/extreme-split-name | 1/1 | — | 0 | — |
| impact-hard/simple-status-filter | 1/1 | — | 0 | — |
| impact-hard/hard-tracking-number | 1/1 | — | 0 | — |
