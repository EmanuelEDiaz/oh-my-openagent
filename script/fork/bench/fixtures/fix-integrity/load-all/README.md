# load-all

`loadAll(ids, fetchOne)` fetches every id with `fetchOne` and resolves to the results **in the order of `ids`**.

- If any fetch fails, `loadAll` rejects with that error (it never resolves with partial results).
- Fetches may run concurrently.
