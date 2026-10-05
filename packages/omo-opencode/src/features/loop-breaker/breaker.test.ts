import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLoopBreaker, runIdFor } from "./breaker"
import { fingerprintError, similarity } from "./fingerprint"

let dir = ""
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "loop-breaker-")) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const breaker = () => createLoopBreaker({ projectDir: dir, maxPerTask: 6, thresholds: { nudge: 2, research: 3, block: 4 } })
const FAIL = (n: number) => `bun test v1.3.14\nsrc/a.test.ts:\n(fail) adds two numbers [${n}.12ms]\nerror: expect(received).toBe(expected)\nExpected: 3\nReceived: -1\n at /home/u/p${n}/src/a.test.ts:${10 + n}:5\n 0 pass\n 1 fail`

describe("error fingerprints (fork 0.9b)", () => {
  test("the same failure hashes the same across runs; a different failure does not", () => {
    expect(fingerprintError(FAIL(1))?.key).toBe(fingerprintError(FAIL(7))?.key)
    expect(fingerprintError(FAIL(1))?.summary).toContain("test: adds two numbers")
    expect(fingerprintError("TypeError: x is not a function at /a/b.ts:3:4")?.key).not.toBe(fingerprintError(FAIL(1))?.key)
    expect(fingerprintError("error TS2322: Type 'number' is not assignable to type 'string'. src/a.ts(3,7)")).toBeDefined()
  })

  test("token similarity spots an almost identical fix", () => {
    expect(similarity("return a + b", "return  a + b ")).toBe(1)
    expect(similarity("return a + b", "throw new Error('x')")).toBeLessThan(0.5)
  })
})

describe("loop breaker (fork 0.9b)", () => {
  test("2 failed fixes nudge, 3 research and block until a fresh debugger, 4 block for the user; each spends budget", () => {
    const b = breaker()
    expect(b.observeError("root", FAIL(1))).toBeUndefined()
    b.recordEdit("root", [{ file: "src/a.ts", text: "return a - b + 0" }])
    expect(b.observeError("root", FAIL(2))).toBeUndefined()
    b.recordEdit("root", [{ file: "src/a.ts", text: "const x = 1\nreturn a * b" }])
    const two = b.observeError("root", FAIL(3))
    expect(two?.level).toBe(2)
    expect(two?.budget.used).toBe(1)
    b.recordEdit("root", [{ file: "src/b.ts", text: "export function helper() { return 42 }" }])
    const three = b.observeError("root", FAIL(4))
    expect(three?.level).toBe(3)
    expect(b.blockedFor("root")?.files).toEqual(["src/a.ts", "src/b.ts"])
    b.onDebugger("root")
    expect(b.blockedFor("root")).toBeUndefined()
    b.recordEdit("root", [{ file: "src/a.ts", text: "if (a === 1 && b === 2) return 3" }])
    const four = b.observeError("root", FAIL(5))
    expect(four?.level).toBe(4)
    expect(four?.budget.used).toBe(3)
    b.onDebugger("root")
    expect(b.blockedFor("root")?.level).toBe(4)
    b.onUserDecision("root")
    expect(b.blockedFor("root")).toBeUndefined()
  })

  test("an almost identical fix goes straight to level 4", () => {
    const b = breaker()
    b.observeError("r", FAIL(1))
    b.recordEdit("r", [{ file: "src/a.ts", text: "return a + b" }])
    b.observeError("r", FAIL(2))
    b.recordEdit("r", [{ file: "src/a.ts", text: "return  a + b" }])
    const out = b.observeError("r", FAIL(3))
    expect(out?.level).toBe(4)
    expect(out?.repeatedFix).toBe(true)
  })

  test("a passing run clears the error; a new request resets the budget but keeps history; state survives restarts", () => {
    const b = breaker()
    b.observeError("r", FAIL(1))
    b.recordEdit("r", [{ file: "src/a.ts", text: "x1" }])
    b.observeError("r", FAIL(2))
    b.recordEdit("r", [{ file: "src/a.ts", text: "completely different y2 z2" }])
    expect(b.observeError("r", FAIL(3))?.level).toBe(2)
    b.observeSuccess("r")
    b.recordEdit("r", [{ file: "src/a.ts", text: "another try w3" }])
    expect(b.observeError("r", FAIL(4))).toBeUndefined()
    b.newRequest("r")
    expect(b.budget("r").used).toBe(0)
    const path = join(dir, ".omo", "runs", runIdFor("r"), "loops.json")
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, "utf8")).errors).toBeDefined()
    expect(createLoopBreaker({ projectDir: dir, maxPerTask: 6, thresholds: { nudge: 2, research: 3, block: 4 } }).attemptsSummary("r", Object.keys(JSON.parse(readFileSync(path, "utf8")).errors)[0]!).length).toBeGreaterThan(0)
  })

  test("the shared budget is exhausted at the cap (stalls and loops charge the same counter)", () => {
    const b = createLoopBreaker({ projectDir: dir, maxPerTask: 2, thresholds: { nudge: 2, research: 3, block: 4 } })
    expect(b.charge("r", "stall").exhausted).toBe(false)
    expect(b.charge("r", "stall").exhausted).toBe(true)
  })
})
