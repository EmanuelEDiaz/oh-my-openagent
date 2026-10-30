import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder } from "../src/client/sdk/orders"
import { renderOrderPage } from "../src/client/views/customer/order-page"
import { schemaProblems } from "../src/db/schema"
import { orders } from "../src/db/seed"
import { shippedEmail } from "../src/notifications/order-mailer"
import { getOrderSummary } from "../src/services/order-service"
import { orderEventPayload } from "../src/webhooks/order-events"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: the tracking number is stored", () => {
  expect(schemaProblems("orders", orders)).toEqual([])
})

test("hidden: the shipping email has the tracking number", () => {
  expect(shippedEmail(getOrderSummary("o3")!).body).toContain("TRK-3003")
})

test("hidden: the shipped webhook has the tracking number", () => {
  const data = orderEventPayload("order.shipped", getOrderSummary("o3")!).data as Record<string, unknown>
  expect(Object.values(data)).toContain("TRK-3003")
})

test("hidden: the customer sees it only when there is one", async () => {
  expect(renderOrderPage(await fetchOrder(api, "o3"))).toContain("TRK-3003")
  expect(renderOrderPage(await fetchOrder(api, "o1"))).not.toMatch(/tracking/i)
})
