import { expect, test } from "bun:test"

import { fetchOrders } from "../src/client/orders-api"
import { handle } from "../src/server/routes"

const api = (url: string) => handle(new Request(`http://app.test${url}`))

test("hidden: the API filters by status", async () => {
  const body = (await (await api("/api/orders?status=paid")).json()) as Array<{ id: string }>
  expect(body.map((order) => order.id)).toEqual(["o1"])
})

test("hidden: the client can ask for one status, and still gets all without it", async () => {
  expect((await fetchOrders(api, "shipped")).map((order) => order.id)).toEqual(["o3"])
  expect(await fetchOrders(api)).toHaveLength(3)
})

test("hidden: an unknown status is a 400", async () => {
  expect((await api("/api/orders?status=lost")).status).toBe(400)
})
