import { expect, test } from "bun:test"

import { matches } from "../src/glob"

test("hidden: question mark is one char", () => expect(matches("a?.md", "ab.md")).toBe(true))
test("hidden: question mark is not zero chars", () => expect(matches("a?.md", "a.md")).toBe(false))
test("hidden: dot inside a name", () => expect(matches("v1.2.txt", "v1x2.txt")).toBe(false))
test("hidden: plus and parens are literal", () => expect(matches("c++(1).txt", "c++(1).txt")).toBe(true))
test("hidden: brackets are literal", () => expect(matches("[draft].md", "d.md")).toBe(false))
test("hidden: dollar is literal", () => expect(matches("$HOME.*", "$HOME.cfg")).toBe(true))
