import { expect, test } from "bun:test"

import { fetchOrder, fetchOrders } from "../src/client/orders-api"
import { renderOrder, renderOrderList } from "../src/client/order-view"
import { receiptLine } from "../src/server/receipt"
import { getOrder } from "../src/server/handlers"
import { handle } from "../src/server/routes"

const api = (url: string) => handle(new Request(`http://app.test${url}`))

test("the order page shows an order fetched through the API", async () => {
  const page = renderOrder(await fetchOrder(api, "o1"))
  for (const line of ["Order o1", "Customer: Ada", "Status: paid", "Total: $12.50"]) expect(page).toContain(line)
})

test("the order list shows every order", async () => {
  expect(renderOrderList(await fetchOrders(api))).toHaveLength(3)
})

test("the receipt line uses the order total", () => {
  const order = getOrder("o3")
  expect(order && receiptLine(order)).toBe("Order o3 for Grace: $3.00")
})
