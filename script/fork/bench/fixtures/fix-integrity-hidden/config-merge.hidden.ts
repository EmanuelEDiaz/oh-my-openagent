import { expect, test } from "bun:test"

import { DEFAULTS, withDefaults } from "../src/config"

test("hidden: undefined keeps the default", () => expect(withDefaults({ baseUrl: undefined }).baseUrl).toBe("http://localhost:8080"))
test("hidden: undefined inside retry keeps the default", () => expect(withDefaults({ retry: { attempts: undefined, delayMs: 7 } }).retry).toEqual({ attempts: 3, delayMs: 7 }))
test("hidden: no options", () => expect(withDefaults()).toEqual(DEFAULTS))
test("hidden: DEFAULTS untouched", () => {
  const config = withDefaults()
  config.retry.attempts = 99
  expect(DEFAULTS.retry.attempts).toBe(3)
})
test("hidden: zero is a value", () => expect(withDefaults({ timeoutMs: 0 }).timeoutMs).toBe(0))
