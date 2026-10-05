# glob-match

`globToRegExp(pattern)` turns a file glob into an anchored `RegExp`.

- `*` matches any run of characters except `/`.
- `?` matches exactly one character except `/`.
- Every other character matches itself literally (`.`, `+`, `(`, `[`, `$`, … included).
