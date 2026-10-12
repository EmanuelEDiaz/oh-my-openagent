# sync-batch

`syncAll(items, upload)` uploads every pending note to the server.

- One failing upload must not stop the others.
- The result lists what was uploaded and what failed: `{ uploaded: string[], failed: { id, reason }[] }`. The reason
  is the upload error's message, so the app can show it and offer a retry.
- `bun test` runs the tests; `bun run typecheck` checks the types.
