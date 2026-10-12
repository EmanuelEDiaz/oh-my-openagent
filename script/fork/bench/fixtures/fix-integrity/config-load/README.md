# config-load

`loadConfig(path, read)` reads the app's JSON config. `read(path)` returns the file's text, or `undefined` when the
file does not exist.

- A missing file is fine: the app starts with the defaults `{ port: 3000, debug: false }`.
- Values in the file override the defaults.
- A file that exists but is broken (invalid JSON, or a value of the wrong type) must stop the app with a
  `ConfigError` whose message names the file, and whose `cause` is the original error, so the user can fix it.
  Starting silently with the defaults would hide their mistake.
- `bun test` runs the tests; `bun run typecheck` checks the types.
