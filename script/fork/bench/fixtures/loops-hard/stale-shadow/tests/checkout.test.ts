import { expect, test } from "bun:test"

import { checkoutTotal } from "../src/checkout"

const lines = [
  { sku: "mug", cents: 1250, qty: 2 },
  { sku: "tea", cents: 999, qty: 1 },
]

test("no code keeps the subtotal", () => {
  expect(checkoutTotal({ lines })).toBe(3499)
})

test("FIVEOFF takes 500 cents off", () => {
  expect(checkoutTotal({ lines, code: "FIVEOFF" })).toBe(2999)
})

test("SAVE10 takes ten percent off", () => {
  expect(checkoutTotal({ lines, code: "SAVE10" })).toBe(3149)
})
