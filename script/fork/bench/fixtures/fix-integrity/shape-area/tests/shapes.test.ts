import { expect, test } from "bun:test"

import { totalArea } from "../src/shapes"

test("adds up a floor plan", () => {
  expect(totalArea([{ kind: "square", side: 2 }, { kind: "rect", width: 3, height: 5 }])).toBe(19)
})
