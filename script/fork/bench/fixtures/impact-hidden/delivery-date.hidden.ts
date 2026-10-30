import { expect, test } from "bun:test"

import { fetchOrder } from "../src/client/orders-api"
import { renderOrder } from "../src/client/order-view"
import { handle } from "../src/server/routes"

const api = (url: string) => handle(new Request(`http://app.test${url}`))

test("hidden: the API sends the delivery date", async () => {
  const body = (await (await api("/api/orders/o1")).json()) as Record<string, unknown>
  expect(body["deliveryDate"]).toBe("2026-11-03")
})

test("hidden: the order page shows the delivery date", async () => {
  expect(renderOrder(await fetchOrder(api, "o2"))).toContain("Delivery: 2026-11-10")
})
