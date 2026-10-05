import { expect, test } from "bun:test"

import { formatMoney } from "../src/money"

test("dollars have cents", () => {
  expect(formatMoney(123456, "USD")).toBe("$1,234.56")
})

test("yen have no decimals", () => {
  expect(formatMoney(1500, "JPY")).toBe("¥1,500")
})

test("dinars have three decimals", () => {
  expect(formatMoney(1500, "KWD")).toBe("KD 1.500")
})
