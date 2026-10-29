import { expect, test } from "bun:test"

import { fetchOrder, fetchOrders } from "../src/client/orders-api"
import { renderOrder, renderOrderList } from "../src/client/order-view"
import { getOrder } from "../src/server/handlers"
import { receiptLine } from "../src/server/receipt"
import { handle } from "../src/server/routes"

const api = (url: string) => handle(new Request(`http://app.test${url}`))

test("hidden: the API field is totalCents, not total", async () => {
  const body = (await (await api("/api/orders/o2")).json()) as Record<string, unknown>
  expect(body["totalCents"]).toBe(4999)
  expect("total" in body).toBe(false)
})

test("hidden: the order page and the list still show the total", async () => {
  expect(renderOrder(await fetchOrder(api, "o2"))).toContain("Total: $49.99")
  expect(renderOrderList(await fetchOrders(api))[0]).toContain("$12.50")
})

test("hidden: the receipt still shows the total", () => {
  const order = getOrder("o1")
  expect(order && receiptLine(order)).toBe("Order o1 for Ada: $12.50")
})
