import { expect, test } from "bun:test"

import { totalsByCategory } from "../src/ledger"

const EXPORT = "date,category,amount\r\n2024-01-01,food,10\r\n2024-01-02,rent,500\r\n2024-01-03,food,20\r\n"

test("sums the bank export per category", () => {
  expect(totalsByCategory(EXPORT)).toEqual({ food: 30, rent: 500 })
})
