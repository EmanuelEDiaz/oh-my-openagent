import { expect, test } from "bun:test"

import { displayName, labels } from "../src/users"

test("hidden: blank nickname falls back to the name", () => expect(displayName({ id: 3, name: "Eva", nickname: "   " })).toBe("Eva"))
test("hidden: nickname is trimmed", () => expect(displayName({ id: 4, name: "Bo", nickname: "  bobby " })).toBe("bobby"))
test("hidden: empty nickname falls back to the name", () => expect(displayName({ id: 5, name: "Iris", nickname: "" })).toBe("Iris"))
test("hidden: mixed list", () => expect(labels([{ id: 1, name: "A" }, { id: 2, name: "B", nickname: "bee" }])).toEqual(["A (#1)", "bee (#2)"]))
test("hidden: empty list", () => expect(labels([])).toEqual([]))
