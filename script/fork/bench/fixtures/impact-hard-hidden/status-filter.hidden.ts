import { expect, test } from "bun:test"

import { handle } from "../src/api/router"
import { fetchOrders } from "../src/client/sdk/orders"

const api = (url: string) => handle(new Request(`http://shop.test${url}`))

test("hidden: the list filters by status", async () => {
  const body = (await (await api("/api/v2/orders?status=paid")).json()) as Array<Record<string, unknown>>
  expect(body.map((order) => order["id"])).toEqual(["o1"])
})

test("hidden: an unknown status is a 400", async () => {
  expect((await api("/api/v2/orders?status=lost")).status).toBe(400)
})

test("hidden: the client can ask for one status", async () => {
  expect((await fetchOrders(api, "shipped")).map((order) => order.id)).toEqual(["o3"])
  expect(await fetchOrders(api)).toHaveLength(3)
})
