import { expect, test } from "bun:test"

import { formatTask } from "../src/format"
import { overdue } from "../src/overdue"
import { parseTasks } from "../src/task"

test("hidden: format with a due date", () => expect(formatTask(parseTasks('[{"id":1,"title":"Pay rent","due":"2026-03-01"}]')[0]!)).toBe("Pay rent — due 2026-03-01"))
test("hidden: format without a due date", () => expect(formatTask(parseTasks('[{"id":2,"title":"Read","due":null}]')[0]!)).toBe("Read — no due date"))
test("hidden: due today is not overdue", () => expect(overdue(parseTasks('[{"id":1,"title":"T","due":"2026-04-01"}]'), "2026-04-01")).toEqual([]))
test("hidden: nothing overdue", () => expect(overdue([], "2026-04-01")).toEqual([]))
test("hidden: tasks without date are never overdue", () => expect(overdue(parseTasks('[{"id":1,"title":"T"},{"id":2,"title":"U","due":null}]'), "2099-01-01")).toEqual([]))
