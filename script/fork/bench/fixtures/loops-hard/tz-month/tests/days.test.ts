import { expect, test } from "bun:test"

import { addDays, nightsBetween } from "../src/days"

test("addDays moves across months and leap days", () => {
  expect(addDays("2024-02-28", 1)).toBe("2024-02-29")
  expect(addDays("2024-01-31", 1)).toBe("2024-02-01")
})

test("addDays across the autumn clock change", () => {
  expect(addDays("2024-11-03", 1)).toBe("2024-11-04")
})

test("nightsBetween counts nights", () => {
  expect(nightsBetween("2024-01-30", "2024-02-02")).toBe(3)
})
