import { expect, test } from "bun:test"

process.env.TZ = "America/Los_Angeles"

const { addDays, formatDay, parseDay } = await import("../src/day")

test("hidden: UTC midnight west of Greenwich", () => expect(parseDay("2024-11-03").getTime()).toBe(Date.UTC(2024, 10, 3)))
test("hidden: across a DST change", () => expect(addDays("2024-03-09", 1)).toBe("2024-03-10"))
test("hidden: going back across a year", () => expect(addDays("2024-01-01", -1)).toBe("2023-12-31"))
test("hidden: round trip", () => expect(formatDay(parseDay("2000-02-29"))).toBe("2000-02-29"))
test("hidden: rejects garbage", () => expect(() => parseDay("10/03/2024")).toThrow(SyntaxError))
