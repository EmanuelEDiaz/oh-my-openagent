import { expect, test } from "bun:test"
import { join } from "node:path"

import { loadConfig } from "../src/config"

const fixture = (name: string) => join(import.meta.dir, "fixtures", name)

test("duration strings are read", () => {
  expect(loadConfig(fixture("worker.json"))).toEqual({ name: "worker", timeoutMs: 1500, retries: 3 })
})

test("the billing config loads", () => {
  expect(loadConfig(fixture("app.json"))).toEqual({ name: "billing", timeoutMs: 30_000, retries: 5 })
})
