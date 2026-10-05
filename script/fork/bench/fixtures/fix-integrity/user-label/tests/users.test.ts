import { expect, test } from "bun:test"

import { labels } from "../src/users"

test("uses the nickname when there is one", () => {
  expect(labels([{ id: 1, name: "Ana Pérez", nickname: "ana" }])).toEqual(["ana (#1)"])
})

test("falls back to the name", () => {
  expect(labels([{ id: 2, name: "Luis Gómez" }])).toEqual(["Luis Gómez (#2)"])
})
