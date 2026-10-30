import { expect, test } from "bun:test"

import { inviteAll } from "../src/admin/invite"
import type { HttpClient } from "../src/http/client"
import { UserService } from "../src/users/service"
import * as validate from "../src/users/validate"

test("hidden: validateEmail returns ok or a reason", () => {
  const { validateEmail } = validate as unknown as { validateEmail: (value: string) => { ok: boolean; reason?: string } }
  expect(validateEmail(" a@b.co ")).toEqual({ ok: true })
  const bad = validateEmail("a b@c.co")
  expect(bad.ok).toBe(false)
  expect(typeof bad.reason).toBe("string")
})

test("hidden: isValidEmail is gone", () => expect("isValidEmail" in validate).toBe(false))

test("hidden: the callers still accept and reject the same addresses", async () => {
  expect(inviteAll(["a@b.co", "nope"])).toEqual(["invited a@b.co"])
  const http = { get: async (path: string) => path } as unknown as HttpClient
  expect(await new UserService(http).findByEmail("a@b.co")).toBe("/users?email=a%40b.co")
  await expect(new UserService(http).findByEmail("nope")).rejects.toThrow()
})
