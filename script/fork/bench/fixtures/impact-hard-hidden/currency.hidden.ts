import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder, fetchOrders } from "../src/client/sdk/orders"
import { renderAdminOrder } from "../src/client/views/admin/order-detail"
import { renderOrdersTable } from "../src/client/views/admin/orders-table"
import { renderOrderHistory } from "../src/client/views/customer/order-history"
import { renderOrderPage } from "../src/client/views/customer/order-page"
import { schemaProblems } from "../src/db/schema"
import { orders } from "../src/db/seed"
import { exportOrdersCsv } from "../src/export/orders-csv"
import { nightlyReport } from "../src/jobs/nightly-report"
import { confirmationEmail } from "../src/notifications/order-mailer"
import { getOrderSummary } from "../src/services/order-service"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: the currency is stored", () => {
  expect(schemaProblems("orders", orders)).toEqual([])
})

test("hidden: customer screens show EUR and USD", async () => {
  expect(renderOrderPage(await fetchOrder(api, "o2"))).toContain("Total: 49,99 €")
  expect(renderOrderPage(await fetchOrder(api, "o1"))).toContain("Total: $12.50")
  const history = renderOrderHistory(await fetchOrders(api)).split("\n")
  expect(history[1]).toContain("44,99 €")
})

test("hidden: admin screens show EUR", async () => {
  expect(renderOrdersTable(await fetchOrders(api)).split("\n")[2]).toContain("49,99 €")
  expect(renderAdminOrder(await fetchOrder(api, "o2"))).toContain("49,99 €")
})

test("hidden: the email and the nightly report use the order currency", () => {
  expect(confirmationEmail(getOrderSummary("o2")!).body).toContain("You pay: 44,99 €")
  const report = nightlyReport()
  expect(report).toContain("pending: 49,99 €")
  expect(report).toContain("paid: $12.50")
})

test("hidden: the CSV says the currency", () => {
  expect(exportOrdersCsv().split("\n")[2]).toContain("EUR")
})
