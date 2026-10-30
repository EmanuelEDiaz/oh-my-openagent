import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrder, fetchOrders } from "../src/client/sdk/orders"
import { printOrders } from "../src/scripts/print-orders"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: the API serves purchases", async () => {
  const list = await api("/api/v2/purchases")
  expect(list.status).toBe(200)
  expect((await list.json()) as unknown[]).toHaveLength(3)
  expect(((await (await api("/api/v2/purchases/o1")).json()) as Record<string, unknown>)["id"]).toBe("o1")
})

test("hidden: the old path is gone", async () => {
  expect((await api("/api/v2/orders")).status).toBe(404)
  expect((await api("/api/v2/orders/o1")).status).toBe(404)
})

test("hidden: the client follows the new path", async () => {
  expect(await fetchOrders(api)).toHaveLength(3)
  expect((await fetchOrder(api, "o2")).id).toBe("o2")
  expect((await printOrders()).split("\n")).toHaveLength(4)
})
