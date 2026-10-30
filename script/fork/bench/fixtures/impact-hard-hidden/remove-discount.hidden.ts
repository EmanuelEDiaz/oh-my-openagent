import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder, fetchOrders } from "../src/client/sdk/orders"
import { renderOrdersTable } from "../src/client/views/admin/orders-table"
import { renderOrderPage } from "../src/client/views/customer/order-page"
import { schemaProblems } from "../src/db/schema"
import { orders } from "../src/db/seed"
import { exportOrdersCsv } from "../src/export/orders-csv"
import { confirmationEmail } from "../src/notifications/order-mailer"
import { getOrderSummary } from "../src/services/order-service"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: no discount is stored", () => {
  expect(schemaProblems("orders", orders)).toEqual([])
  expect(Object.keys(orders[1]!).some((key) => /discount/i.test(key))).toBe(false)
})

test("hidden: the API sends no discount", async () => {
  const body = (await (await api("/api/v2/orders/o2")).json()) as Record<string, unknown>
  expect(Object.keys(body).some((key) => /discount/i.test(key))).toBe(false)
})

test("hidden: no screen mentions a discount and o2 pays the full price", async () => {
  expect(renderOrderPage(await fetchOrder(api, "o2"))).not.toMatch(/discount/i)
  expect(renderOrdersTable(await fetchOrders(api)).split("\n")[0]).not.toMatch(/discount/i)
})

test("hidden: the confirmation email has no discount line", () => {
  const body = confirmationEmail(getOrderSummary("o2")!).body
  expect(body).not.toMatch(/discount/i)
  expect(body).toContain("You pay: $49.99")
})

test("hidden: the CSV has no discount column", () => {
  expect(exportOrdersCsv().split("\n")[0]).not.toMatch(/discount/i)
})
