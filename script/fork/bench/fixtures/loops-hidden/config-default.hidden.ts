import { expect, test } from "bun:test"

import { DEFAULT_LIMITS, loadLimits } from "../src/config"
import { createPost } from "../src/posts"

const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

test("hidden: defaults when unset", () => expect(loadLimits({})).toEqual(DEFAULT_LIMITS))
test("hidden: ten tags by default", () => expect(() => createPost({ title: "x", tags: tags(10) }, {})).not.toThrow())
test("hidden: eleven tags rejected by default", () => expect(() => createPost({ title: "x", tags: tags(11) }, {})).toThrow("too many tags"))
test("hidden: MAX_TAGS override", () => {
  expect(() => createPost({ title: "x", tags: tags(3) }, { MAX_TAGS: "3" })).not.toThrow()
  expect(() => createPost({ title: "x", tags: tags(4) }, { MAX_TAGS: "3" })).toThrow("too many tags")
})
test("hidden: MAX_TAGS=0 forbids tags", () => expect(() => createPost({ title: "x", tags: tags(1) }, { MAX_TAGS: "0" })).toThrow("too many tags"))
test("hidden: non-numeric keeps the default", () => expect(loadLimits({ MAX_TITLE_LENGTH: "lots" }).maxTitleLength).toBe(40))
test("hidden: title override", () => expect(() => createPost({ title: "abcdef", tags: [] }, { MAX_TITLE_LENGTH: "5" })).toThrow("too long"))
