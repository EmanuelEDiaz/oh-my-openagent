import { expect, test } from "bun:test"

import { matches } from "../src/glob"

test("matches an extension", () => expect(matches("*.ts", "index.ts")).toBe(true))
test("the dot is literal", () => expect(matches("*.ts", "indexts")).toBe(false))
test("star stops at slashes", () => expect(matches("*.ts", "src/index.ts")).toBe(false))
