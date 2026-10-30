import { expect, test } from "bun:test"

import { fetchOrder } from "../src/client/orders-api"
import { renderOrder } from "../src/client/order-view"
import { handle } from "../src/server/routes"

const api = (url: string) => handle(new Request(`http://app.test${url}`))

test("hidden: the API no longer sends discountCode", async () => {
  for (const id of ["o1", "o2"]) {
    const body = (await (await api(`/api/orders/${id}`)).json()) as Record<string, unknown>
    expect("discountCode" in body).toBe(false)
  }
})

test("hidden: the order page no longer shows a discount", async () => {
  expect(renderOrder(await fetchOrder(api, "o2")).join("\n")).not.toContain("Discount")
})
