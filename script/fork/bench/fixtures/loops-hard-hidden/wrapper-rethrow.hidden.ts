import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadConfig } from "../src/config"

const dir = mkdtempSync(join(tmpdir(), "cfg-hidden-"))
function file(name: string, text: string): string {
  writeFileSync(join(dir, name), text)
  return join(dir, name)
}

test("hidden: numeric and string timeouts", () => {
  expect(loadConfig(file("a.json", '{"name":"a","timeout":2}'))).toEqual({ name: "a", timeoutMs: 2000, retries: 3 })
  expect(loadConfig(file("b.json", '{"name":"b","timeout":"2m","retries":0}'))).toEqual({ name: "b", timeoutMs: 120_000, retries: 0 })
  expect(loadConfig(file("c.json", '{"name":"c"}'))).toEqual({ name: "c", timeoutMs: 10_000, retries: 3 })
})

test("hidden: real JSON errors still say so", () => {
  expect(() => loadConfig(file("broken.json", '{"name": "x",'))).toThrow("Invalid JSON in broken.json")
})

test("hidden: other errors are not reported as JSON errors", () => {
  expect(() => loadConfig(file("noname.json", '{"timeout": 5}'))).toThrow("config: name is required")
})
