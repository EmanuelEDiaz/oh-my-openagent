import { expect, test } from "bun:test"

import { withDefaults } from "../src/config"

test("keeps the default retry delay", () => {
  expect(withDefaults({ retry: { attempts: 5 } }).retry).toEqual({ attempts: 5, delayMs: 100 })
})

test("caller values win", () => expect(withDefaults({ timeoutMs: 100 }).timeoutMs).toBe(100))
