import { expect, test } from "bun:test"

import { formatPercent } from "../src/percent"

test("one decimal", () => expect(formatPercent(0.1234)).toBe("12.3%"))

test("the half label fits the 4-character badge", () => {
  const label = formatPercent(0.5)
  expect(label).toBe("50.0%")
  expect(label.length).toBeLessThanOrEqual(4)
})
