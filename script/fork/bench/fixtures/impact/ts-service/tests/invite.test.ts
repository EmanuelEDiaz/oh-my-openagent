import { expect, test } from "bun:test"

import { inviteAll } from "../src/admin/invite"

test("only valid addresses are invited", () => expect(inviteAll(["a@b.co", "a b@c.co", "x@y"])).toEqual(["invited a@b.co"]))
