import { expect, test } from "bun:test"

import { checkoutBanner } from "../src/checkout"

test("shows the promo by default", () => expect(checkoutBanner({})).toContain("Free shipping"))

test("ops can switch the promo off", () => expect(checkoutBanner({ FEATURE_PROMO: "false" })).toBe(""))
