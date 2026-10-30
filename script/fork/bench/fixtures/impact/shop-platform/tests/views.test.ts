import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder, fetchOrders } from "../src/client/sdk/orders"
import { renderOrdersTable } from "../src/client/views/admin/orders-table"
import { renderOrderPage } from "../src/client/views/customer/order-page"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("the customer sees the order with its total", async () => {
  const page = renderOrderPage(await fetchOrder(api, "o1"))
  expect(page).toContain("Order o1")
  expect(page).toContain("Total: $12.50")
})

test("the admin table lists every order", async () => {
  const table = renderOrdersTable(await fetchOrders(api)).split("\n")
  expect(table).toHaveLength(4)
  expect(table[1]).toContain("o1")
})

test("an unknown path is a 404", async () => {
  expect((await api("/api/v2/nothing")).status).toBe(404)
})
