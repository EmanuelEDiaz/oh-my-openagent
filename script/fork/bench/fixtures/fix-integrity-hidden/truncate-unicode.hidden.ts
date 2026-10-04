import { expect, test } from "bun:test"

import { truncate } from "../src/truncate"

test("hidden: never splits a surrogate pair", () => expect(truncate("a👍b👍c", 4)).toBe("a👍b…"))
test("hidden: emoji at the cut", () => expect(truncate("👍👍👍👍", 3)).toBe("👍👍…"))
test("hidden: result length in code points", () => expect([...truncate("𝒜𝒝𝒞𝒟𝒠𝒡", 4)].length).toBe(4))
test("hidden: max 1", () => expect(truncate("abc", 1)).toBe("…"))
test("hidden: rejects zero", () => expect(() => truncate("abc", 0)).toThrow(RangeError))
