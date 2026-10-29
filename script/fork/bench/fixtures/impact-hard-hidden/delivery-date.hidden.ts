import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder, fetchOrders } from "../src/client/sdk/orders"
import { renderOrdersTable } from "../src/client/views/admin/orders-table"
import { renderOrderPage } from "../src/client/views/customer/order-page"
import { schemaProblems } from "../src/db/schema"
import { orders } from "../src/db/seed"
import { exportOrdersCsv } from "../src/export/orders-csv"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: the seed still matches the migrated schema", () => {
  expect(schemaProblems("orders", orders)).toEqual([])
})

test("hidden: the API sends the delivery date", async () => {
  const body = (await (await api("/api/v2/orders/o1")).json()) as Record<string, unknown>
  expect(body["delivery_date"] ?? body["deliveryDate"]).toBe("2026-11-03")
})

test("hidden: the customer sees the delivery date, or pending", async () => {
  expect(renderOrderPage(await fetchOrder(api, "o1"))).toContain("Delivery: 2026-11-03")
  expect(renderOrderPage(await fetchOrder(api, "o3"))).toContain("Delivery: pending")
})

test("hidden: the admin table has a delivery column", async () => {
  const [header, , second] = renderOrdersTable(await fetchOrders(api)).split("\n")
  expect(header).toContain("Delivery")
  expect(second).toContain("2026-11-10")
})

test("hidden: the accounting CSV has the delivery date", () => {
  const [header, first] = exportOrdersCsv().split("\n")
  expect(header).toMatch(/delivery/i)
  expect(first).toContain("2026-11-03")
})
