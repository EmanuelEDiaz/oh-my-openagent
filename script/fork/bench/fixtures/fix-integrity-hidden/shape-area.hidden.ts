import { expect, test } from "bun:test"

import { area, perimeter, totalArea } from "../src/shapes"

test("hidden: rectangle area", () => expect(area({ kind: "rect", width: 4, height: 2.5 })).toBe(10))
test("hidden: rectangle perimeter", () => expect(perimeter({ kind: "rect", width: 4, height: 2.5 })).toBe(13))
test("hidden: square perimeter", () => expect(perimeter({ kind: "square", side: 3 })).toBe(12))
test("hidden: circle area", () => expect(area({ kind: "circle", radius: 1 })).toBeCloseTo(Math.PI))
test("hidden: no shapes", () => expect(totalArea([])).toBe(0))
test("hidden: unknown kind still throws", () => expect(() => area({ kind: "hexagon" } as never)).toThrow())
