import { expect, test } from "bun:test"

import { topScores } from "../src/top"

test("hidden: input order is kept", () => {
  const scores = [5, 1, 4]
  topScores(scores, 2)
  expect(scores).toEqual([5, 1, 4])
})
test("hidden: frozen input works", () => expect(topScores(Object.freeze([2, 8, 5]) as number[], 2)).toEqual([8, 5]))
test("hidden: n larger than the list", () => expect(topScores([1, 2], 5)).toEqual([2, 1]))
