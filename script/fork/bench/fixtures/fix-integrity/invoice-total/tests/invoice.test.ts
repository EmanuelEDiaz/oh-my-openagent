import { expect, test } from "bun:test"

import { invoiceTotal, parseLines, totalQuantity } from "../src/invoice"

const CSV = "sku,quantity,unitPrice\nA-1,2,1.25\nB-7,1,5.10\n"

test("totals the invoice", () => {
  expect(invoiceTotal(parseLines(CSV))).toBe(7.6)
})

test("counts the units", () => expect(totalQuantity(parseLines(CSV))).toBe(3))
