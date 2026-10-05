import { expect, test } from "bun:test"

import { lineTotal } from "../src/invoice"
import { formatEuro, round2 } from "../src/money"

const HALVES: ReadonlyArray<readonly [number, number]> = [
  [1.005, 1.01],
  [2.675, 2.68],
  [10.235, 10.24],
  [128.045, 128.05],
  [-1.005, -1.01],
  [1.0049, 1],
  [0.1 + 0.2, 0.3],
]

test("round2 rounds half away from zero", () => {
  for (const [input, expected] of HALVES) expect({ input, rounded: round2(input) }).toEqual({ input, rounded: expected })
})

test("formatEuro prints cents", () => {
  expect(formatEuro(1.005)).toBe("€1.01")
  expect(formatEuro(3)).toBe("€3.00")
})

test("a line with an exact price", () => {
  expect(lineTotal({ unitPrice: 2.5, qty: 4 })).toBe(10)
})
