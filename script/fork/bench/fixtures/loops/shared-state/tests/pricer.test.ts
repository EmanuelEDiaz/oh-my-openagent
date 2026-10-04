import { expect, test } from "bun:test"

import { createPricer } from "../src/pricer"

test("applies a coupon", () => {
  const pricer = createPricer()
  pricer.addDiscount({ code: "WELCOME10", percent: 10 })
  expect(pricer.total(1000)).toBe(900)
})

test("a new cart pays full price", () => {
  expect(createPricer().total(1000)).toBe(1000)
})
