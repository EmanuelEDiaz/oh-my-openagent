import { expect, test } from "bun:test"

import { findTokens, isValidToken } from "../src/auth"
import { TOKEN } from "../src/patterns"

test("hidden: TOKEN.test is repeatable", () => {
  expect(TOKEN.test("deadbeef")).toBe(true)
  expect(TOKEN.test("deadbeef")).toBe(true)
  expect(TOKEN.test("DEADBEEF")).toBe(true)
})
test("hidden: many checks", () => expect([1, 2, 3, 4, 5].map(() => isValidToken(" cafebabe "))).toEqual([true, true, true, true, true]))
test("hidden: still rejects bad tokens", () => expect(isValidToken("deadbeef1")).toBe(false))
test("hidden: findTokens finds every token", () => expect(findTokens("a deadbeef b CAFEBABE c 1234")).toEqual(["deadbeef", "cafebabe"]))
test("hidden: findTokens twice", () => {
  expect(findTokens("deadbeef")).toEqual(["deadbeef"])
  expect(findTokens("deadbeef")).toEqual(["deadbeef"])
})
