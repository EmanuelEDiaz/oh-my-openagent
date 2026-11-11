import { describe, expect, test } from "bun:test"
import { fromRoman, toRoman } from "../src/roman"

describe("roman numerals", () => {
  test("toRoman", () => {
    expect(toRoman(1)).toBe("I")
    expect(toRoman(4)).toBe("IV")
    expect(toRoman(1994)).toBe("MCMXCIV")
    expect(toRoman(3999)).toBe("MMMCMXCIX")
  })
  test("fromRoman round-trips every value", () => {
    for (let value = 1; value <= 3999; value++) expect(fromRoman(toRoman(value))).toBe(value)
  })
  test("rejects out of range and invalid numerals", () => {
    expect(() => toRoman(0)).toThrow()
    expect(() => toRoman(4000)).toThrow()
    for (const bad of ["", "IIII", "IC", "VX", "MMMM", "abc"]) expect(() => fromRoman(bad)).toThrow()
  })
})
