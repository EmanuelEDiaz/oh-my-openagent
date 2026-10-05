import { expect, test } from "bun:test"

import { addDays, nightsBetween } from "../src/days"

function inZone<T>(zone: string, run: () => T): T {
  const previous = process.env.TZ
  process.env.TZ = zone
  try {
    return run()
  } finally {
    process.env.TZ = previous
  }
}

const CASES: ReadonlyArray<readonly [string, number, string]> = [
  ["2024-12-31", 1, "2025-01-01"],
  ["2025-03-01", -1, "2025-02-28"],
  ["2024-03-09", 2, "2024-03-11"],
  ["2024-10-26", 3, "2024-10-29"],
  ["2023-02-28", 1, "2023-03-01"],
  ["2024-06-15", 0, "2024-06-15"],
]

for (const zone of ["America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata", "UTC"]) {
  test(`hidden: day arithmetic in ${zone}`, () => {
    inZone(zone, () => {
      for (const [day, n, expected] of CASES) expect({ day, n, result: addDays(day, n) }).toEqual({ day, n, result: expected })
      expect(nightsBetween("2024-10-26", "2024-11-05")).toBe(10)
      expect(nightsBetween("2024-03-01", "2024-02-28")).toBe(-2)
    })
  })
}
