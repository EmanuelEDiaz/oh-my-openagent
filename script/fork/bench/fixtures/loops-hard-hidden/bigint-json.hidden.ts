import { expect, test } from "bun:test"

import { orderUrl, parseOrders } from "../src/orders"

test("hidden: every 64-bit id survives", () => {
  const body = '[ {"total": 1.25, "id": 18446744073709551615}, {"id":1234567890123456789,"total":0}, {"id": 7, "total": 3} ]'
  expect(parseOrders(body)).toEqual([
    { id: "18446744073709551615", total: 1.25 },
    { id: "1234567890123456789", total: 0 },
    { id: "7", total: 3 },
  ])
})

test("hidden: totals stay numbers", () => {
  const [order] = parseOrders('[{"id": 9007199254740995, "total": 99.99}]')
  expect(order).toEqual({ id: "9007199254740995", total: 99.99 })
  expect(orderUrl(order!)).toBe("/dashboard/orders/9007199254740995")
})

test("hidden: an empty response", () => {
  expect(parseOrders("[]")).toEqual([])
})
