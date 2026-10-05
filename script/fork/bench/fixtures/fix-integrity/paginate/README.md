# paginate

`paginate(items, page, pageSize)` returns one page of `items`.

- Pages are **1-based**: page 1 is the first `pageSize` items.
- `totalPages` is the number of pages needed to show every item (0 for an empty list).
- A page past the end returns an empty `items` array.
