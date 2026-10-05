# shape-area

Geometry helpers for the floor-plan editor.

- `Shape` is a circle (`radius`), a square (`side`) or a rectangle (`width` × `height`).
- `area(shape)` and `perimeter(shape)` work for every kind of shape.
- `totalArea(shapes)` is the sum of the areas (0 for no shapes).
- `bun test` runs the tests; `bun run typecheck` checks the types.
