# config-merge

`withDefaults(options)` fills a partial client configuration with `DEFAULTS`.

- A value the caller sets wins over the default.
- A value the caller leaves `undefined` keeps the default.
- `retry` is merged field by field: `{ retry: { attempts: 5 } }` keeps the default `retry.delayMs`.
- `DEFAULTS` is never modified.
