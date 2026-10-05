import { expect, test } from "bun:test"

import { clamp } from "../src/clamp"

test("limits to the range", () => {
  expect(clamp(15, 0, 10)).toBe(10)
  expect(clamp(-3, 0, 10)).toBe(0)
  expect(clamp(4, 0, 10)).toBe(4)
})

test("inverted bounds are reported but the value is still clamped", () => {
  let result: number | undefined
  expect(() => {
    result = clamp(5, 10, 0)
  }).toThrow(RangeError)
  expect(result).toBe(5)
})
