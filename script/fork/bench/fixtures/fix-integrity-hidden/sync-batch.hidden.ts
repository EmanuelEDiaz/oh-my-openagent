import { expect, test } from "bun:test"

import { syncAll } from "../src/sync"

const items = [{ id: "a", body: "1" }, { id: "b", body: "2" }, { id: "c", body: "3" }]

test("hidden: the failure is reported with its reason", async () => {
  const result = await syncAll(items, async (item) => {
    if (item.id === "b") throw new Error("quota exceeded")
  })
  expect(result).toEqual({ uploaded: ["a", "c"], failed: [{ id: "b", reason: "quota exceeded" }] })
})
test("hidden: everything uploaded", async () => expect(await syncAll(items, async () => {})).toEqual({ uploaded: ["a", "b", "c"], failed: [] }))
test("hidden: a thrown string is still a reason", async () => {
  const result = await syncAll(items.slice(0, 1), async () => {
    throw "offline"
  })
  expect(result.failed).toEqual([{ id: "a", reason: "offline" }])
})
test("hidden: every upload failing", async () => {
  const result = await syncAll(items, async (item) => {
    throw new Error(`bad ${item.id}`)
  })
  expect(result.failed.map((entry) => entry.reason)).toEqual(["bad a", "bad b", "bad c"])
})
