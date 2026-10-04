import { expect, test } from "bun:test"

import { paginate } from "../src/paginate"

const letters = ["a", "b", "c", "d", "e"]

test("first page holds the first items", () => {
  expect(paginate(letters, 1, 2).items).toEqual(["a", "b"])
})

test("counts the pages", () => {
  expect(paginate(letters, 1, 2).totalPages).toBe(3)
})
