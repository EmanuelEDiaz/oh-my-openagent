# app config

`loadConfig(path)` reads a JSON config file and returns it normalised:

- `name`: string, required.
- `timeout`: seconds as a number (`30`) or a duration string (`"30s"`, `"1500ms"`, `"2m"`); returned as `timeoutMs`.
  Defaults to 10 seconds.
- `retries`: integer, defaults to 3.

A file that is not valid JSON makes `loadConfig` throw `Invalid JSON in <file name>`; a missing `name` throws
`config: name is required`.
