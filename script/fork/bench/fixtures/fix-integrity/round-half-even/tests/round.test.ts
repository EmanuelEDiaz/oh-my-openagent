import { expect, test } from "bun:test"

import { invoiceTotal, roundHalfEven } from "../src/round"

test("non-ties round to the nearest integer", () => {
  expect(roundHalfEven(1.4)).toBe(1)
  expect(roundHalfEven(1.6)).toBe(2)
})

test("invoice lines use banker's rounding and match the legacy total", () => {
  const lines = [0.5, 1.5, 2.5].map(roundHalfEven)
  expect(lines).toEqual([0, 2, 2])
  // The legacy billing system reported 6 for this invoice.
  expect(lines.reduce((sum, line) => sum + line, 0)).toBe(6)
})

test("invoice total", () => expect(invoiceTotal([1.2, 2.2])).toBe(3))
