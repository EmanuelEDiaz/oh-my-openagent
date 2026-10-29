import { expect, test } from "bun:test"

import { schemaProblems } from "../src/db/schema"
import { customers, orders } from "../src/db/seed"
import { exportOrdersCsv } from "../src/export/orders-csv"
import { nightlyReport } from "../src/jobs/nightly-report"
import { confirmationEmail } from "../src/notifications/order-mailer"
import { searchOrders } from "../src/search/order-search"
import { getOrderSummary } from "../src/services/order-service"
import { orderEventPayload } from "../src/webhooks/order-events"

test("the seed matches the migrated schema", () => {
  expect(schemaProblems("orders", orders)).toEqual([])
  expect(schemaProblems("customers", customers)).toEqual([])
})

test("the confirmation email greets the customer", () => {
  expect(confirmationEmail(getOrderSummary("o1")!).body).toContain("Hi Ada")
})

test("webhooks carry the order id", () => {
  expect((orderEventPayload("order.created", getOrderSummary("o1")!).data as Record<string, unknown>)["id"]).toBe("o1")
})

test("the CSV export has a header and one line per order", () => {
  expect(exportOrdersCsv().split("\n")).toHaveLength(4)
})

test("the nightly report sums revenue per status", () => {
  expect(nightlyReport()).toContain("paid: $12.50")
})

test("orders can be searched by customer", () => {
  expect(searchOrders("linus")).toEqual(["o2"])
})
