import { expect, test } from "bun:test"

import { loadAll } from "../src/load"

test("loads every id", async () => {
  expect(await loadAll(["a", "b"], async (id) => id.toUpperCase())).toEqual(["A", "B"])
})

test("rejects when a fetch fails", async () => {
  const failing = async (id: string) => {
    if (id === "b") throw new Error("boom")
    return id
  }
  await expect(loadAll(["a", "b"], failing)).rejects.toThrow("boom")
})
