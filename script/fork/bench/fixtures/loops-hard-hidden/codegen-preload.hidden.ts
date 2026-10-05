import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { generate } from "../scripts/codegen"
import { formatMoney } from "../src/money"

test("hidden: the generator keeps a zero minor unit", () => {
  const table = generate()
  expect(table["JPY"]?.decimals).toBe(0)
  expect(table["USD"]?.decimals).toBe(2)
  expect(table["KWD"]?.decimals).toBe(3)
})

test("hidden: the schema still holds the ISO 4217 data", () => {
  const schema = JSON.parse(readFileSync(join(import.meta.dir, "../schema/currencies.json"), "utf8"))
  expect(schema.JPY).toEqual({ symbol: "¥", minor_units: 0 })
  expect(schema.USD.minor_units).toBe(2)
})

test("hidden: formatted amounts", () => {
  expect(formatMoney(1234567, "JPY")).toBe("¥1,234,567")
  expect(formatMoney(5, "USD")).toBe("$0.05")
})
