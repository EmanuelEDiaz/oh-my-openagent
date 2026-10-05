import { expect, test } from "bun:test"

import { isoWeek } from "../src/week"

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day))

test("ISO weeks", () => {
  expect(isoWeek(utc(2021, 1, 4))).toBe(1)
  expect(isoWeek(utc(2020, 12, 31))).toBe(53)
  expect(isoWeek(utc(2021, 1, 1))).toBe(53)
})

test("January 1st is always in week 1", () => {
  for (const year of [2019, 2020, 2021, 2022]) expect(isoWeek(utc(year, 1, 1))).toBe(1)
})
