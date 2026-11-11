import { describe, expect, test } from "bun:test"
import { parseDuration } from "../src/duration"

describe("parseDuration", () => {
  test("single units", () => {
    expect(parseDuration("45m")).toBe(45)
    expect(parseDuration("2h")).toBe(120)
    expect(parseDuration("1d")).toBe(1440)
  })
  test("combined units in order", () => {
    expect(parseDuration("1h30m")).toBe(90)
    expect(parseDuration("1d2h5m")).toBe(1565)
  })
  test("rejects malformed input", () => {
    for (const bad of ["", "h", "30", "1m1h", "1h1h", "-2h", "1.5h", "2 h"]) expect(() => parseDuration(bad)).toThrow()
  })
})
