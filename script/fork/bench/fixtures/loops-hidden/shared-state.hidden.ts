import { expect, test } from "bun:test"

import { NO_DISCOUNTS } from "../src/discounts"
import { createPricer } from "../src/pricer"

test("hidden: pricers are independent", () => {
  const a = createPricer()
  const b = createPricer()
  a.addDiscount({ code: "A", percent: 50 })
  expect(b.total(1000)).toBe(1000)
  expect(a.total(1000)).toBe(500)
})
test("hidden: options array untouched", () => {
  const initial = [{ code: "X", percent: 10 }]
  const pricer = createPricer({ discounts: initial })
  pricer.addDiscount({ code: "Y", percent: 10 })
  expect(initial).toHaveLength(1)
  expect(pricer.total(1000)).toBe(810)
})
test("hidden: NO_DISCOUNTS stays empty", () => {
  createPricer().addDiscount({ code: "Z", percent: 5 })
  expect(NO_DISCOUNTS).toHaveLength(0)
})
