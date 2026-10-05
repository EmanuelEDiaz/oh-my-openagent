import { expect, test } from "bun:test"

import { formatEuro, round2 } from "../src/money"

const HIDDEN: ReadonlyArray<readonly [number, number]> = [
  [289.275, 289.28],
  [569.675, 569.68],
  [-2.675, -2.68],
  [-128.045, -128.05],
  [0.615, 0.62],
  [4.355, 4.36],
  [1.45, 1.45],
  [7, 7],
  [0.004, 0],
]

test("hidden: more halves away from zero", () => {
  for (const [input, expected] of HIDDEN) expect({ input, rounded: round2(input) }).toEqual({ input, rounded: expected })
})

test("hidden: formatting negative halves", () => {
  expect(formatEuro(-2.675)).toBe("€-2.68")
  expect(formatEuro(569.675)).toBe("€569.68")
})
