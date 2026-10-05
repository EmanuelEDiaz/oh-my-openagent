import { expect, test } from "bun:test"

import { roundCents } from "../src/round"

test("hidden: negative tie goes away from zero", () => expect(roundCents(-1.005)).toBe(-1.01))
test("hidden: 2.675", () => expect(roundCents(2.675)).toBe(2.68))
test("hidden: 0.125", () => expect(roundCents(0.125)).toBe(0.13))
test("hidden: -0.125", () => expect(roundCents(-0.125)).toBe(-0.13))
test("hidden: below a tie rounds down", () => expect(roundCents(1.004)).toBe(1))
test("hidden: integers stay", () => expect(roundCents(10)).toBe(10))
test("hidden: 8.345", () => expect(roundCents(8.345)).toBe(8.35))
