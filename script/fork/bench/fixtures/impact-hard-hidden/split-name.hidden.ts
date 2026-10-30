import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder, fetchOrders } from "../src/client/sdk/orders"
import { renderAdminOrder } from "../src/client/views/admin/order-detail"
import { renderOrdersTable } from "../src/client/views/admin/orders-table"
import { schemaProblems } from "../src/db/schema"
import { customers } from "../src/db/seed"
import { confirmationEmail, shippedEmail } from "../src/notifications/order-mailer"
import { searchOrders } from "../src/search/order-search"
import { getOrderSummary } from "../src/services/order-service"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: first and last names are stored apart", () => {
  expect(schemaProblems("customers", customers)).toEqual([])
  expect(Object.keys(customers[0]!)).not.toContain("name")
})

test("hidden: the customers API sends both names", async () => {
  const body = (await (await api("/api/v2/customers/c1")).json()) as Record<string, unknown>
  expect(body["first_name"] ?? body["firstName"]).toBe("Ada")
  expect(body["last_name"] ?? body["lastName"]).toBe("Lovelace")
})

test("hidden: emails greet by first name", () => {
  expect(confirmationEmail(getOrderSummary("o1")!).body.startsWith("Hi Ada,\n")).toBe(true)
  expect(shippedEmail(getOrderSummary("o3")!).body.startsWith("Hi Grace,\n")).toBe(true)
})

test("hidden: admin screens show Last, First", async () => {
  expect(renderOrdersTable(await fetchOrders(api)).split("\n")[1]).toContain("Lovelace, Ada")
  expect(renderAdminOrder(await fetchOrder(api, "o2"))).toContain("Customer: Torvalds, Linus")
})

test("hidden: orders are still found by the customer's last name", () => {
  expect(searchOrders("lovelace")).toEqual(["o1"])
})
