import { expect, test } from "bun:test"

import { overdue } from "../src/overdue"
import { parseTasks } from "../src/task"

const API = JSON.stringify([
  { id: 1, title: "Pay rent", due: "2026-03-01" },
  { id: 2, title: "Renew passport", due: "2026-01-15" },
  { id: 3, title: "Read book" },
  { id: 4, title: "Book flights", due: "2026-06-30" },
])

test("lists overdue tasks, earliest first", () => {
  expect(overdue(parseTasks(API), "2026-04-01")).toEqual(["Renew passport", "Pay rent"])
})
