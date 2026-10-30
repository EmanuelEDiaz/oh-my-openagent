import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder, fetchOrders } from "../src/client/sdk/orders"
import { renderOrdersTable } from "../src/client/views/admin/orders-table"
import { renderOrderPage } from "../src/client/views/customer/order-page"
import { schemaProblems } from "../src/db/schema"
import { orders } from "../src/db/seed"
import { exportOrdersCsv } from "../src/export/orders-csv"
import { nightlyReport } from "../src/jobs/nightly-report"
import { getOrderSummary } from "../src/services/order-service"
import { orderEventPayload } from "../src/webhooks/order-events"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: the API sends amount_cents and no total_cents", async () => {
  const body = (await (await api("/api/v2/orders/o1")).json()) as Record<string, unknown>
  expect(body["amount_cents"]).toBe(1250)
  expect("total_cents" in body).toBe(false)
})

test("hidden: the client screens still show the total", async () => {
  expect(renderOrderPage(await fetchOrder(api, "o1"))).toContain("Total: $12.50")
  expect(renderOrdersTable(await fetchOrders(api)).split("\n")[1]).toContain("$12.50")
})

test("hidden: webhooks send amount_cents too", () => {
  const data = orderEventPayload("order.created", getOrderSummary("o1")!).data as Record<string, unknown>
  expect(data["amount_cents"]).toBe(1250)
  expect("total_cents" in data).toBe(false)
})

test("hidden: the database and the CSV keep total_cents", () => {
  expect(schemaProblems("orders", orders)).toEqual([])
  expect(exportOrdersCsv().split("\n")[0]).toContain("total_cents")
  expect(nightlyReport()).toContain("paid: $12.50")
})
