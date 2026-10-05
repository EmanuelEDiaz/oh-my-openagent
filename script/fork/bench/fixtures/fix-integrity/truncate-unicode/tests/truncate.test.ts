import { expect, test } from "bun:test"

import { truncate } from "../src/truncate"

test("short ascii is unchanged", () => expect(truncate("hello", 5)).toBe("hello"))
test("emoji count as one", () => expect(truncate("👍👍👍", 3)).toBe("👍👍👍"))
test("cuts ascii", () => expect(truncate("hello world", 6)).toBe("hello…"))
