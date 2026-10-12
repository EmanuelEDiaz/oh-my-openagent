# user-fetch

`getUser(id, fetchJson)` loads a user for the profile page.

- It returns the user, or `null` when the server answers 404 (the user does not exist; the page shows "not found").
- Any other failure (the network is down, a 500) must reject with a `UserLoadError` that keeps the original error
  as its `cause`: the page then shows "could not load, try again". Showing "not found" for a network error would be
  wrong.
- `bun test` runs the tests; `bun run typecheck` checks the types.
