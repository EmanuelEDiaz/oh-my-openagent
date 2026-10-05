import { expect, test } from "bun:test"

import { parseCsv } from "../src/csv"
import { totalsByCategory } from "../src/ledger"

test("hidden: CRLF header keys are clean", () => expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]))
test("hidden: last column text has no carriage return", () => expect(parseCsv("n,note\r\n1,hello\r\n2,bye")[1]?.note).toBe("bye"))
test("hidden: LF still works", () => expect(parseCsv("a,b\n1,2\n3,4")).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]))
test("hidden: blank lines ignored", () => expect(parseCsv("a\r\n1\r\n\r\n2\r\n")).toEqual([{ a: "1" }, { a: "2" }]))
test("hidden: amount not last", () => expect(totalsByCategory("amount,category\r\n5,x\r\n7,x\r\n")).toEqual({ x: 12 }))
