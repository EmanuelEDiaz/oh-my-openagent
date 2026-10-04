import { expect, test } from "bun:test"

import { readBool } from "../src/env"
import { isEnabled } from "../src/flags"

test("hidden: false values", () => {
  for (const value of ["0", "false", "FALSE", "no", "Off", "", " no "]) expect(readBool(value, true)).toBe(false)
})
test("hidden: true values", () => {
  for (const value of ["1", "true", "Yes", "ON", " true "]) expect(readBool(value, false)).toBe(true)
})
test("hidden: unknown falls back", () => {
  expect(readBool("maybe", true)).toBe(true)
  expect(readBool("maybe", false)).toBe(false)
})
test("hidden: camelCase flag", () => expect(isEnabled("newCheckout", { FEATURE_NEW_CHECKOUT: "1" })).toBe(true))
test("hidden: default off", () => expect(isEnabled("newCheckout", {})).toBe(false))
