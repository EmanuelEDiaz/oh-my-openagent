import { expect, test } from "bun:test"
import { average } from "../src/math"

test("average of 2 and 4 is 3", () => {
  expect(average([2, 4])).toBe(3)
})
