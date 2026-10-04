import { expect, test } from "bun:test"

import { createAudit } from "../src/audit"
import { EventBus } from "../src/bus"
import { createUserService } from "../src/users"

test("records only the next save", () => {
  const bus = new EventBus()
  const audit = createAudit(bus)
  const users = createUserService(bus)
  audit.recordNext("first-save")
  users.save({ id: 1, name: "Ana" })
  users.save({ id: 1, name: "Ana B." })
  expect(audit.entries).toEqual(["first-save:1"])
})
