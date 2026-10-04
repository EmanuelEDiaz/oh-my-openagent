import { expect, test } from "bun:test"

import { EventBus } from "../src/bus"

test("hidden: once fires once", () => {
  const bus = new EventBus()
  let calls = 0
  bus.once("e", () => calls++)
  bus.emit("e", 1)
  bus.emit("e", 2)
  bus.emit("e", 3)
  expect(calls).toBe(1)
})
test("hidden: off cancels a pending once", () => {
  const bus = new EventBus()
  let calls = 0
  const listener = () => calls++
  bus.once("e", listener)
  bus.off("e", listener)
  bus.emit("e", 1)
  expect(calls).toBe(0)
})
test("hidden: on listeners keep firing", () => {
  const bus = new EventBus()
  const seen: unknown[] = []
  bus.on("e", (p) => seen.push(p))
  bus.emit("e", 1)
  bus.emit("e", 2)
  expect(seen).toEqual([1, 2])
})
