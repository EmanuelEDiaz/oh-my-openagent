# truncate-unicode

`truncate(text, max)` shortens text for a fixed-width label.

- Length is counted in **Unicode code points**, not UTF-16 units: `"👍"` has length 1.
- Text of at most `max` code points is returned unchanged.
- Longer text becomes its first `max - 1` code points followed by `"…"` (so the result has exactly `max`).
- A code point is never split.
