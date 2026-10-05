import { expect, test } from "bun:test"

import { orderUrl, parseOrders } from "../src/orders"

const BODY = '[{"id": 42, "total": 19.5}, {"id": 9007199254740993, "total": 120}]'

test("small ids", () => {
  expect(parseOrders(BODY)[0]).toEqual({ id: "42", total: 19.5 })
})

test("links point at the right order", () => {
  const orders = parseOrders(BODY)
  expect(orders.map(orderUrl)).toEqual(["/dashboard/orders/42", "/dashboard/orders/9007199254740993"])
})
