import { expect, test } from "bun:test"

import { leaderboard, topScores } from "../src/top"

test("returns the highest scores", () => expect(topScores([3, 9, 1, 7], 2)).toEqual([9, 7]))

test("labels the leaderboard with the right names", () => {
  expect(leaderboard(["ana", "bo", "cy", "di"], [3, 9, 1, 7])).toEqual(["bo: 9", "di: 7", "ana: 3"])
})
