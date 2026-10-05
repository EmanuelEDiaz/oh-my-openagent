import { expect, test } from "bun:test"

import { can, permissionsFor } from "../src/permissions"

test("admins inherit everything", () => {
  expect(permissionsFor({ id: 1, roles: ["admin"] })).toEqual(["delete", "invite", "read", "write"])
})

test("viewers cannot delete", () => {
  expect(can({ id: 2, roles: ["viewer"] }, "delete")).toBe(false)
})
