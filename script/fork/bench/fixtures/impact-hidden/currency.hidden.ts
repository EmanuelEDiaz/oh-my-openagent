import { expect, test } from "bun:test"

import { fetchOrder, fetchOrders } from "../src/client/orders-api"
import { renderOrder, renderOrderList } from "../src/client/order-view"
import { getOrder } from "../src/server/handlers"
import { receiptLine } from "../src/server/receipt"
import { handle } from "../src/server/routes"
import { formatMoney } from "../src/shared/money"

const api = (url: string) => handle(new Request(`http://app.test${url}`))

test("hidden: formatMoney takes the currency", () => {
  expect(formatMoney(1250, "USD")).toBe("$12.50")
  expect(formatMoney(1250, "EUR")).toBe("12,50 €")
})

test("hidden: the API sends each order's currency", async () => {
  const body = (await (await api("/api/orders/o2")).json()) as Record<string, unknown>
  expect(body["currency"]).toBe("EUR")
})

test("hidden: the page, the list and the receipt use the order's currency", async () => {
  expect(renderOrder(await fetchOrder(api, "o2"))).toContain("Total: 49,99 €")
  expect(renderOrderList(await fetchOrders(api)).join("\n")).toContain("49,99 €")
  const order = getOrder("o2")
  expect(order && receiptLine(order)).toBe("Order o2 for Linus: 49,99 €")
  expect(renderOrder(await fetchOrder(api, "o1"))).toContain("Total: $12.50")
})
