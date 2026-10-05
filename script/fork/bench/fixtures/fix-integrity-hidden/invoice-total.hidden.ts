import { expect, test } from "bun:test"

import { invoiceTotal, lineTotal, parseLines } from "../src/invoice"
import { sumBy } from "../src/sum"

test("hidden: line total multiplies", () => expect(lineTotal(parseLines("sku,quantity,unitPrice\nX,3,0.5\n")[0]!)).toBe(1.5))
test("hidden: rounds to cents", () => expect(invoiceTotal(parseLines("sku,quantity,unitPrice\nA,3,0.1\nB,1,0.2\n"))).toBe(0.5))
test("hidden: no lines", () => expect(invoiceTotal([])).toBe(0))
test("hidden: header only", () => expect(invoiceTotal(parseLines("sku,quantity,unitPrice\n"))).toBe(0))
test("hidden: blank lines ignored", () => expect(invoiceTotal(parseLines("sku,quantity,unitPrice\n\nA,1,2\n\n"))).toBe(2))
test("hidden: sumBy adds numbers", () => expect(sumBy([{ n: 1 }, { n: 2.5 }], "n")).toBe(3.5))
