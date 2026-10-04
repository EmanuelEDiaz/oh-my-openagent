import { expect, test } from "bun:test"

import { paginate } from "../src/paginate"

const letters = ["a", "b", "c", "d", "e"]

test("hidden: middle page", () => expect(paginate(letters, 2, 2).items).toEqual(["c", "d"]))
test("hidden: last partial page", () => expect(paginate(letters, 3, 2).items).toEqual(["e"]))
test("hidden: past the end is empty", () => expect(paginate(letters, 4, 2).items).toEqual([]))
test("hidden: empty list has no pages", () => expect(paginate([], 1, 3)).toEqual({ items: [], page: 1, totalPages: 0 }))
test("hidden: exact fit", () => expect(paginate(letters, 1, 5).items).toEqual(letters))
