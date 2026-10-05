import { expect, test } from "bun:test"

import { formatEuros, roundCents } from "../src/round"

test("rounds a tie up", () => expect(roundCents(1.005)).toBe(1.01))
test("keeps exact cents", () => expect(roundCents(2.5)).toBe(2.5))
test("formats euros", () => expect(formatEuros(1.005)).toBe("1.01 €"))
