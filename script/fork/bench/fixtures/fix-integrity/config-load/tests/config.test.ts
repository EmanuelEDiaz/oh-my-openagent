import { expect, test } from "bun:test"

import { DEFAULTS, loadConfig } from "../src/config"

test("a missing config file starts the app with the defaults", () => {
  expect(loadConfig("/etc/app/app.json", () => undefined)).toEqual(DEFAULTS)
})
