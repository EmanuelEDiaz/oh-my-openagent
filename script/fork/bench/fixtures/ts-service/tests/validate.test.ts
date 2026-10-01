import { expect, test } from "bun:test"

import { isValidEmail } from "../src/users/validate"

test("accepts a normal address", () => expect(isValidEmail("a@b.co")).toBe(true))
test("rejects spaces", () => expect(isValidEmail("a b@c.co")).toBe(false))
