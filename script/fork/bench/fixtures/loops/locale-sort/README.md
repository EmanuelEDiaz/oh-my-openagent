# name-index

`renderIndex(names)` renders an index of names grouped by their first character, one line per group:
`"<initial>: <name>, <name>"`.

The legacy importer that reads this index requires **plain code-point order** (what you get comparing
strings with `<`): uppercase before lowercase, digits before letters, never locale-dependent. Both the groups
and the names inside a group use that order. `sortNames(names)` exposes the same order.
