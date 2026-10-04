import { expect, test } from "bun:test"

process.env.TZ = "Pacific/Kiritimati"

const { parseDay, addDays } = await import("../src/day")

test("parses at UTC midnight", () => {
  expect(parseDay("2024-03-10").toISOString()).toBe("2024-03-10T00:00:00.000Z")
})

test("adds days", () => expect(addDays("2024-02-28", 1)).toBe("2024-02-29"))
