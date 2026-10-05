import { expect, test } from "bun:test"

import { memoize } from "../src/memo"
import { permissionsFor } from "../src/permissions"

test("hidden: equal arguments are cached", () => {
  let calls = 0
  const square = memoize((n: number) => {
    calls++
    return n * n
  })
  expect(square(3)).toBe(9)
  expect(square(3)).toBe(9)
  expect(calls).toBe(1)
})
test("hidden: objects with different values", () => {
  const read = memoize((o: { a: number }) => o.a)
  expect(read({ a: 1 })).toBe(1)
  expect(read({ a: 2 })).toBe(2)
})
test("hidden: every argument counts", () => {
  const add = memoize((a: number, b: number) => a + b)
  expect(add(1, 2)).toBe(3)
  expect(add(1, 3)).toBe(4)
})
test("hidden: 1 and '1' differ", () => {
  const type = memoize((v: unknown) => typeof v)
  expect(type(1)).toBe("number")
  expect(type("1")).toBe("string")
})
test("hidden: editor", () => expect(permissionsFor({ id: 3, roles: ["editor"] })).toEqual(["read", "write"]))
