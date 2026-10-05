import { expect, test } from "bun:test"

import { checkoutTotal } from "../src/checkout"
import { applyDiscount } from "../src/pricing.ts"

test("hidden: SAVE10 through checkout is a percentage, rounded", () => {
  expect(checkoutTotal({ lines: [{ sku: "a", cents: 1234, qty: 1 }], code: "SAVE10" })).toBe(1111)
  expect(checkoutTotal({ lines: [{ sku: "a", cents: 20000, qty: 3 }], code: "SAVE10" })).toBe(54000)
})

test("hidden: the TypeScript source itself is fixed", () => {
  expect(applyDiscount(3499, "SAVE10")).toBe(3149)
  expect(applyDiscount(300, "FIVEOFF")).toBe(0)
  expect(applyDiscount(300, "NOPE")).toBe(300)
})
