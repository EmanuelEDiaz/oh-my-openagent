import { expect, test } from "bun:test"

import { sortNames } from "../src/group"
import { renderIndex } from "../src/render"

test("hidden: code-point order with symbols and accents", () => expect(sortNames(["é", "z", "Z", "_", "a"])).toEqual(["Z", "_", "a", "z", "é"]))
test("hidden: digits are text", () => expect(sortNames(["9", "10", "1"])).toEqual(["1", "10", "9"]))
test("hidden: names inside a group", () => expect(renderIndex(["ab", "aB", "Ab"])).toBe("A: Ab\na: aB, ab"))
test("hidden: input untouched", () => {
  const names = ["b", "a"]
  sortNames(names)
  expect(names).toEqual(["b", "a"])
})
