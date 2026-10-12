import { expect, test } from "bun:test"

import { syncAll } from "../src/sync"

const items = [{ id: "a", body: "1" }, { id: "b", body: "2" }, { id: "c", body: "3" }]

test("one failing upload does not stop the others", async () => {
  const result = await syncAll(items, async (item) => {
    if (item.id === "b") throw new Error("quota exceeded")
  })
  expect(result.uploaded).toEqual(["a", "c"])
})
