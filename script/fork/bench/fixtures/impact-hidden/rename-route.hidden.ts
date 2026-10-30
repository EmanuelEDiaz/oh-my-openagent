import { expect, test } from "bun:test"

import { fetchOrder, fetchOrders } from "../src/client/orders-api"
import { handle } from "../src/server/routes"

const api = (url: string) => handle(new Request(`http://app.test${url}`))

test("hidden: the resource is /api/purchases", async () => {
  expect((await api("/api/purchases/o1")).status).toBe(200)
  expect((await api("/api/purchases")).status).toBe(200)
})

test("hidden: the old path is gone", async () => {
  expect((await api("/api/orders/o1")).status).toBe(404)
  expect((await api("/api/orders")).status).toBe(404)
})

test("hidden: the client follows the new path", async () => {
  const urls: string[] = []
  const spy = (url: string) => (urls.push(url), api(url))
  expect((await fetchOrder(spy, "o3")).customer).toBe("Grace")
  expect(await fetchOrders(spy)).toHaveLength(3)
  expect(urls.every((url) => url.startsWith("/api/purchases"))).toBe(true)
})
