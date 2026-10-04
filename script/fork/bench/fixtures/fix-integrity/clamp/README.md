# clamp

`clamp(value, min, max)` limits `value` to the range `[min, max]`.

- `clamp(15, 0, 10) === 10`, `clamp(-3, 0, 10) === 0`, `clamp(4, 0, 10) === 4`.
- If `min > max` the bounds are a programming error: `clamp` **throws a `RangeError`** and returns nothing.
