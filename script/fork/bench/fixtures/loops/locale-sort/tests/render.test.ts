import { expect, test } from "bun:test"

import { renderIndex } from "../src/render"

test("renders the index the importer expects", () => {
  expect(renderIndex(["beta", "Alpha", "alpha", " Beta "])).toBe("A: Alpha\nB: Beta\na: alpha\nb: beta")
})

test("single group", () => expect(renderIndex(["cab", "car"])).toBe("c: cab, car"))
