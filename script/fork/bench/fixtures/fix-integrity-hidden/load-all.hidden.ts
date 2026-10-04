import { expect, test } from "bun:test"

import { loadAll } from "../src/load"

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

test("hidden: keeps the order of ids", async () => {
  const delays: Record<string, number> = { a: 30, b: 5, c: 15 }
  expect(await loadAll(["a", "b", "c"], (id) => later(id, delays[id] ?? 0))).toEqual(["a", "b", "c"])
})
test("hidden: empty list", async () => expect(await loadAll([], async () => 1)).toEqual([]))
test("hidden: a late failure still rejects", async () => {
  const fetchOne = async (id: string) => {
    await later(null, id === "z" ? 20 : 1)
    if (id === "z") throw new TypeError("late")
    return id
  }
  await expect(loadAll(["x", "z"], fetchOne)).rejects.toThrow(TypeError)
})
