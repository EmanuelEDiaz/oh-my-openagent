import { expect, test } from "bun:test"

import { authorize } from "../src/middleware"

test("rejects a missing token", () => expect(authorize({})).toEqual({ ok: false, reason: "missing token" }))

test("accepts consecutive requests with valid tokens", () => {
  expect(authorize({ "x-token": "deadbeef" })).toEqual({ ok: true })
  expect(authorize({ "x-token": "0badf00d" })).toEqual({ ok: true })
})
