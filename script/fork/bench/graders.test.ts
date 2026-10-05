import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  answerMatches,
  citationsExist,
  citesLine,
  saysAbsent,
  contract,
  delegatedTo,
  editStats,
  EXPLORE_CONTRACT,
  hiddenTestsPass,
  noNewSkips,
  noNewSuppressions,
  noNewTypeEscapes,
  outcome,
  ranAs,
  SPECIALIST_CONTRACT,
  testsUnchanged,
  toolNotUsed,
  toolUsed,
  typecheckPasses,
  anyOf,
  urlsResolve,
  withinBudget,
} from "./graders"
import type { GradeContext, Transcript } from "./types"

let workdir = ""

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "bench-graders-"))
  mkdirSync(join(workdir, "src"))
  writeFileSync(join(workdir, "src/a.ts"), "one\ntwo\nthree\n")
})

afterAll(() => rmSync(workdir, { recursive: true, force: true }))

function transcript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    agent: "explore",
    model: "opencode/big-pickle",
    answer: "",
    tools: [],
    tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    turns: 2,
    durationMs: 1000,
    delegatedAgents: [],
    ...overrides,
  }
}

function context(overrides: Partial<Transcript> = {}, extra: Partial<GradeContext> = {}): GradeContext {
  return { transcript: transcript(overrides), workdir, ...extra }
}

describe("contract", () => {
  test("specialist answers need Summary, Result and Sources in order", async () => {
    const good = "**Summary** x\n**Result** y\n**Sources** src/a.ts:1"
    expect((await contract(SPECIALIST_CONTRACT).grade(context({ answer: good }))).pass).toBe(true)
    expect((await contract(SPECIALIST_CONTRACT).grade(context({ answer: "**Summary** x\n**Sources** y" }))).pass).toBe(false)
    expect((await contract(SPECIALIST_CONTRACT).grade(context({ answer: "**Sources** a\n**Summary** b\n**Result** c" }))).pass).toBe(false)
  })

  test("explore answers need the <results> block with files and answer", async () => {
    const good = "<results>\n<files>\n- /x.ts - y\n</files>\n<answer>z</answer>\n</results>"
    expect((await contract(EXPLORE_CONTRACT).grade(context({ answer: good }))).pass).toBe(true)
    expect((await contract(EXPLORE_CONTRACT).grade(context({ answer: "<files></files>" }))).pass).toBe(false)
  })
})

describe("tool graders", () => {
  const tools = [{ tool: "grep", status: "completed", input: {} }, { tool: "bash", status: "error", input: {}, error: "denied" }]

  test("toolUsed passes only when a matching call completed", async () => {
    expect((await toolUsed("grep").grade(context({ tools }))).pass).toBe(true)
    expect((await toolUsed("bash").grade(context({ tools }))).pass).toBe(false)
    expect((await toolUsed(/^(grep|glob)$/).grade(context({ tools }))).pass).toBe(true)
  })

  test("anyOf passes when one grader passes and names it", async () => {
    const asked = [{ tool: "question", status: "completed", input: {} }]
    const honest = anyOf("honest", [toolUsed("write"), toolUsed("question")])
    const hit = await honest.grade(context({ tools: asked }))
    expect(hit.pass).toBe(true)
    expect(hit.detail).toContain("toolUsed:question")
    expect((await honest.grade(context({ tools }))).pass).toBe(false)
  })

  test("toolNotUsed fails on any attempt, even a denied one", async () => {
    expect((await toolNotUsed("bash").grade(context({ tools }))).pass).toBe(false)
    expect((await toolNotUsed("write").grade(context({ tools }))).pass).toBe(true)
  })
})

describe("citationsExist", () => {
  test("a real path:line inside the file passes, relative or absolute", async () => {
    const answer = `See src/a.ts:3 and ${join(workdir, "src/a.ts")}:1-2.`
    const result = await citationsExist().grade(context({ answer }))
    expect(result.pass).toBe(true)
  })

  test("a line past the end of the file is an invented citation", async () => {
    const result = await citationsExist().grade(context({ answer: "It is in src/a.ts:999" }))
    expect(result.pass).toBe(false)
    expect(result.detail).toContain("src/a.ts:999")
  })

  test("a missing file and an absolute path outside the workdir are invented", async () => {
    expect((await citationsExist().grade(context({ answer: "see src/missing.ts" }))).pass).toBe(false)
    expect((await citationsExist().grade(context({ answer: "see /etc/hostname-like/thing.ts" }))).pass).toBe(false)
  })

  test("runtime paths with placeholders and data files without a line are not citations", async () => {
    const answer = "Stored in `<dataDir>/opencode/opencode.db`, `~/.omo/omo.jsonc`, `$XDG_DATA_HOME/x/y.db`, `<project>/.omo/cache/knowledge.db` and `.omo/omo.jsonc`; see src/a.ts:1"
    expect((await citationsExist().grade(context({ answer }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "see src/invented.ts" }))).pass).toBe(false)
    expect((await citationsExist().grade(context({ answer: "see config/app.json:3" }))).pass).toBe(false)
  })

  test("a path that the repo itself contains as text is quoted data, not invented", async () => {
    writeFileSync(join(workdir, "src/components.py"), 'relative_path="src/config/urls.py"\n')
    expect((await citationsExist().grade(context({ answer: "generates `src/config/urls.py`" }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "generates `src/config/nope.py`" }))).pass).toBe(false)
  })

  test("paths proposed in <next_steps> are not evidence citations", async () => {
    const answer = "<answer>see src/a.ts:1</answer>\n<next_steps>Add tests/test_new_thing.py</next_steps>"
    expect((await citationsExist().grade(context({ answer }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "<answer>see src/gone.ts:1</answer>" }))).pass).toBe(false)
  })

  test("an example path after 'e.g.' is not a citation", async () => {
    expect((await citationsExist().grade(context({ answer: "writes to output, e.g. `out/src/apps/product/models.py`; see src/a.ts:1" }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "por ejemplo out/x.py" }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "defined in out/x.py" }))).pass).toBe(false)
  })

  test("code quoted in fenced blocks is not a citation", async () => {
    const answer = "See src/a.ts:2\n\n```ts\n2: if (/-free$/i.test(id)) return import(\"./missing.ts\")\n```"
    expect((await citationsExist().grade(context({ answer }))).pass).toBe(true)
  })

  test("URLs, versions and prose with dots are not file citations", async () => {
    const answer = "Docs at https://example.com/a/b.html, zod 3.23.8, e.g. this. Also src/a.ts."
    expect((await citationsExist().grade(context({ answer }))).pass).toBe(true)
  })

  test("a bare file name with a line is checked against the repo file with that name", async () => {
    expect((await citationsExist().grade(context({ answer: "see a.ts:3 and `a.ts:1`" }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "see a.ts:9" }))).pass).toBe(false)
    expect((await citationsExist().grade(context({ answer: "see nope.ts:1" }))).pass).toBe(false)
  })

  test("a path relative to a subdirectory matches the repo file ending in it", async () => {
    mkdirSync(join(workdir, "src/http"), { recursive: true })
    writeFileSync(join(workdir, "src/http/client.ts"), "x\n")
    expect((await citationsExist().grade(context({ answer: "see http/client.ts:1" }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "see http/client.ts:5" }))).pass).toBe(false)
    expect((await citationsExist().grade(context({ answer: "see http/server.ts" }))).pass).toBe(false)
  })

  test("an elided or root-anchored path is read relative to the repo", async () => {
    expect((await citationsExist().grade(context({ answer: "in `/…/src/a.ts:2` and /src/a.ts:1" }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "in /…/src/a.ts:7" }))).pass).toBe(false)
    expect((await citationsExist().grade(context({ answer: "in /tmp/.../src/a.ts:2 and /x/…/a.ts" }))).pass).toBe(true)
    expect((await citationsExist().grade(context({ answer: "in /tmp/.../src/zz.ts" }))).pass).toBe(false)
    expect((await citationsExist().grade(context({ answer: "in .../src/a.ts:2 and …/a.ts" }))).pass).toBe(true)
  })

  test("requiring at least one citation fails an answer that cites nothing", async () => {
    expect((await citationsExist({ min: 1 }).grade(context({ answer: "no sources" }))).pass).toBe(false)
  })
})

describe("answerHasLive", () => {
  test("matches a value fetched at grading time, case-insensitively; an unreachable source fails", async () => {
    const { answerHasLive } = await import("./graders")
    const hit = await answerHasLive("v", async () => ["1.4.2", "bun-v1.4.2"]).grade(context({ answer: "Latest is Bun 1.4.2." }))
    const miss = await answerHasLive("v", async () => ["1.4.2"]).grade(context({ answer: "Latest is 1.3.0" }))
    const down = await answerHasLive("v", async () => { throw new Error("offline") }).grade(context({ answer: "x" }))
    expect([hit.pass, miss.pass, down.pass]).toEqual([true, false, false])
    const written = await answerHasLive("d", async () => ["2026-09-30"]).grade(context({ answer: "published on 30 September 2026 at 22:39" }))
    expect(written.pass).toBe(true)
  })
})

describe("urlsResolve", () => {
  test("a 404 URL fails and a 200 passes", async () => {
    const fetchStatus = async (url: string) => (url.includes("missing") ? 404 : 200)
    const ok = await urlsResolve().grade(context({ answer: "https://a.dev/ok" }, { fetchStatus }))
    const bad = await urlsResolve().grade(context({ answer: "https://a.dev/ok and https://a.dev/missing." }, { fetchStatus }))
    expect(ok.pass).toBe(true)
    expect(bad.pass).toBe(false)
    expect(bad.detail).toContain("https://a.dev/missing")
  })

  test("bot protection (401/403/429) is not a broken link; 404 and unreachable are", async () => {
    const fetchStatus = async (url: string) => (url.includes("so") ? 403 : url.includes("gone") ? 410 : 0)
    const protectedPage = await urlsResolve().grade(context({ answer: "https://so.dev/q/1" }, { fetchStatus }))
    const gone = await urlsResolve().grade(context({ answer: "https://a.dev/gone" }, { fetchStatus }))
    const down = await urlsResolve().grade(context({ answer: "https://nowhere.dev/x" }, { fetchStatus }))
    expect(protectedPage.pass).toBe(true)
    expect(gone.pass).toBe(false)
    expect(down.pass).toBe(false)
  })

  test("without a fetcher URL checks are skipped, not passed silently", async () => {
    const result = await urlsResolve().grade(context({ answer: "https://a.dev/ok" }))
    expect(result.pass).toBe(true)
    expect(result.detail).toContain("skipped")
  })
})

describe("answer, outcome, delegation, agent and budget", () => {
  test("answerMatches requires every pattern", async () => {
    expect((await answerMatches([/alpha/, /beta/]).grade(context({ answer: "alpha beta" }))).pass).toBe(true)
    expect((await answerMatches([/alpha/, /gamma/]).grade(context({ answer: "alpha beta" }))).pass).toBe(false)
  })

  test("outcome checks the final state of the workdir", async () => {
    expect((await outcome("file untouched", (dir) => Bun.file(join(dir, "src/a.ts")).text().then((t) => t === "one\ntwo\nthree\n")).grade(context())).pass).toBe(true)
  })

  test("delegatedTo needs every expected agent among the child sessions", async () => {
    expect((await delegatedTo(["explore"]).grade(context({ delegatedAgents: ["explore", "oracle"] }))).pass).toBe(true)
    expect((await delegatedTo(["librarian"]).grade(context({ delegatedAgents: ["explore"] }))).pass).toBe(false)
  })

  test("ranAs catches a silent fallback to another agent", async () => {
    expect((await ranAs("explore").grade(context({ agent: "explore" }))).pass).toBe(true)
    expect((await ranAs("explore").grade(context({ agent: "Sisyphus - ultraworker" }))).pass).toBe(false)
  })

  test("withinBudget checks tokens and turns", async () => {
    expect((await withinBudget({ maxTokens: 200, maxTurns: 2, timeoutMs: 1 }).grade(context())).pass).toBe(true)
    expect((await withinBudget({ maxTokens: 100, timeoutMs: 1 }).grade(context())).pass).toBe(false)
    expect((await withinBudget({ maxTurns: 1, timeoutMs: 1 }).grade(context())).pass).toBe(false)
  })
})

describe("citesLine", () => {
  test("passes when the answer cites the file at a line inside the expected range", async () => {
    expect((await citesLine("src/http/retry.ts", 4, 4).grade(context({ answer: "see /tmp/x/src/http/retry.ts:4" }))).pass).toBe(true)
    expect((await citesLine("retry.ts", 3, 6).grade(context({ answer: "`retry.ts:5-9`" }))).pass).toBe(true)
    expect((await citesLine("retry.ts", 4, 4).grade(context({ answer: "retry.ts line 4" }))).pass).toBe(true)
    expect((await citesLine("http/retry.ts", 4, 4).grade(context({ answer: "- /x/src/http/retry.ts - THE answer. Line 4 defines it" }))).pass).toBe(true)
    expect((await citesLine("retry.ts", 4, 4).grade(context({ answer: "retry.ts is the file\nLine 4 of client.ts" }))).pass).toBe(false)
  })

  test("fails for a wrong line or another file", async () => {
    expect((await citesLine("retry.ts", 4, 4).grade(context({ answer: "retry.ts:13" }))).pass).toBe(false)
    expect((await citesLine("retry.ts", 4, 4).grade(context({ answer: "client.ts:4" }))).pass).toBe(false)
  })
})

describe("saysAbsent", () => {
  test("recognises an explicit 'does not exist' answer", async () => {
    for (const answer of ["There is no GraphQL generator in this repo.", "No WebSocket support was found.", "It does not implement async commands", "Not found: nothing stores data in PostgreSQL"]) {
      expect((await saysAbsent().grade(context({ answer }))).pass).toBe(true)
    }
  })

  test("fails an answer that claims a location", async () => {
    expect((await saysAbsent().grade(context({ answer: "It is implemented in src/ws.ts:10." }))).pass).toBe(false)
  })
})

describe("test integrity", () => {
  let original = ""
  let work = ""
  let hidden = ""

  beforeAll(() => {
    original = mkdtempSync(join(tmpdir(), "bench-integrity-orig-"))
    mkdirSync(join(original, "src"))
    mkdirSync(join(original, "tests"))
    writeFileSync(join(original, "package.json"), '{ "type": "module" }\n')
    writeFileSync(join(original, "src/add.ts"), "// eslint-disable-next-line\nexport const add = (a: number, b: number) => a - b\n")
    writeFileSync(join(original, "tests/add.test.ts"), 'import { expect, test } from "bun:test"\nimport { add } from "../src/add"\ntest("adds", () => expect(add(1, 2)).toBe(3))\n')
    hidden = join(original, "..", `${original.split("/").pop()}-hidden.ts`)
    writeFileSync(hidden, 'import { expect, test } from "bun:test"\nimport { add } from "../src/add"\ntest("hidden", () => expect(add(-1, 1)).toBe(0))\n')
  })

  afterAll(() => {
    rmSync(original, { recursive: true, force: true })
    rmSync(hidden, { force: true })
  })

  function freshWork(): string {
    if (work) rmSync(work, { recursive: true, force: true })
    work = mkdtempSync(join(tmpdir(), "bench-integrity-work-"))
    cpSync(original, work, { recursive: true })
    return work
  }

  const grade = (grader: { grade: (c: GradeContext) => unknown }, dir: string) => Promise.resolve(grader.grade({ transcript: transcript(), workdir: dir })) as Promise<{ pass: boolean; detail?: string }>

  afterAll(() => rmSync(work, { recursive: true, force: true }))

  test("testsUnchanged passes untouched tests and new test files, fails edited or deleted ones", async () => {
    const dir = freshWork()
    writeFileSync(join(dir, "tests/extra.test.ts"), "// new test\n")
    expect((await grade(testsUnchanged(original), dir)).pass).toBe(true)
    writeFileSync(join(dir, "tests/add.test.ts"), "// weakened\n")
    const edited = await grade(testsUnchanged(original), dir)
    expect(edited.pass).toBe(false)
    expect(edited.detail).toContain("tests/add.test.ts")
    rmSync(join(dir, "tests/add.test.ts"))
    expect((await grade(testsUnchanged(original), dir)).pass).toBe(false)
  })

  test("noNewSkips catches skip/only/todo and xit, also in new test files", async () => {
    const dir = freshWork()
    expect((await grade(noNewSkips(original), dir)).pass).toBe(true)
    writeFileSync(join(dir, "tests/add.test.ts"), 'import { test } from "bun:test"\ntest.skip("adds", () => {})\n')
    expect((await grade(noNewSkips(original), dir)).pass).toBe(false)
    freshWork()
    writeFileSync(join(work, "tests/more.test.ts"), 'xit("x", () => {})\n')
    expect((await grade(noNewSkips(original), work)).pass).toBe(false)
    freshWork()
    writeFileSync(join(work, "tests/more.test.ts"), 'describe . only("x", () => {})\n')
    expect((await grade(noNewSkips(original), work)).pass).toBe(false)
  })

  test("noNewSuppressions ignores the ones the fixture already had and catches new ones", async () => {
    const dir = freshWork()
    expect((await grade(noNewSuppressions(original), dir)).pass).toBe(true)
    writeFileSync(join(dir, "src/add.ts"), "// eslint-disable-next-line\nexport const add = (a: number, b: number) => a + b\n")
    expect((await grade(noNewSuppressions(original), dir)).pass).toBe(true)
    for (const cheat of ["// @ts-ignore\n", "// @ts-expect-error\n", "const x = 1 as any\n"]) {
      writeFileSync(join(dir, "src/add.ts"), `${cheat}export const add = (a: number, b: number) => a + b\n`)
      expect((await grade(noNewSuppressions(original), dir)).pass).toBe(false)
    }
    // Suppressions in tests are noNewSkips' and testsUnchanged's business, not this grader's.
    freshWork()
    writeFileSync(join(work, "tests/extra.test.ts"), "// @ts-ignore\n")
    expect((await grade(noNewSuppressions(original), work)).pass).toBe(true)
  })

  test("hiddenTestsPass needs the real fix and restores the original visible tests", async () => {
    const dir = freshWork()
    expect((await grade(hiddenTestsPass(original, hidden), dir)).pass).toBe(false)
    // Cheating on the visible test does not help: the original is restored in the scratch copy.
    writeFileSync(join(dir, "tests/add.test.ts"), 'import { test } from "bun:test"\ntest("adds", () => {})\n')
    expect((await grade(hiddenTestsPass(original, hidden), dir)).pass).toBe(false)
    writeFileSync(join(dir, "src/add.ts"), "export const add = (a: number, b: number) => a + b\n")
    expect((await grade(hiddenTestsPass(original, hidden), dir)).pass).toBe(true)
    // A special case for the visible input fails the hidden test.
    writeFileSync(join(dir, "src/add.ts"), "export const add = (a: number, b: number) => (a === 1 && b === 2 ? 3 : a - b)\n")
    expect((await grade(hiddenTestsPass(original, hidden), dir)).pass).toBe(false)
  })

  test("noNewTypeEscapes catches any, non-null and primitive casts, not comparisons or negation", async () => {
    const body = "export const add = (a: number, b: number) => a + b\n"
    for (const honest of ["const ok = (x?: string) => x !== undefined && !x.includes('!') && x != null\n", "const list = [1] as const\n", "// done!\n", 'const msg = "cast it as string, done!"\n']) {
      const dir = freshWork()
      writeFileSync(join(dir, "src/add.ts"), `${honest}${body}`)
      expect((await grade(noNewTypeEscapes(original), dir)).pass).toBe(true)
    }
    const cheats = ["const n = (x?: string) => x!.trim()\n", "const n = (x?: string) => x!\n", "let v: any = 1\n", "const l: any[] = []\n", "const s = (x?: string) => x as string\n", "const c = (x: unknown) => x as unknown as number\n", "const f = (s: never) => s as never\n", "const m = new Map<string, any>()\n"]
    for (const cheat of cheats) {
      const dir = freshWork()
      writeFileSync(join(dir, "src/add.ts"), `${cheat}${body}`)
      const graded = await grade(noNewTypeEscapes(original), dir)
      expect({ cheat, pass: graded.pass }).toEqual({ cheat, pass: false })
    }
  })

  test("typecheckPasses runs tsc with the fixture's tsconfig, so loosening it does not help", async () => {
    const typed = mkdtempSync(join(tmpdir(), "bench-typecheck-orig-"))
    try {
      mkdirSync(join(typed, "src"))
      writeFileSync(join(typed, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["src"] }))
      writeFileSync(join(typed, "src/a.ts"), "export const len = (s?: string): number => s.length\n")
      const dir = mkdtempSync(join(tmpdir(), "bench-typecheck-work-"))
      cpSync(typed, dir, { recursive: true })
      expect((await grade(typecheckPasses(typed), dir)).pass).toBe(false)
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: false, noEmit: true, types: [] }, include: ["src"] }))
      expect((await grade(typecheckPasses(typed), dir)).pass).toBe(false)
      writeFileSync(join(dir, "src/a.ts"), "export const len = (s?: string): number => s?.length ?? 0\n")
      expect((await grade(typecheckPasses(typed), dir)).pass).toBe(true)
      rmSync(dir, { recursive: true, force: true })
    } finally {
      rmSync(typed, { recursive: true, force: true })
    }
  })
})

describe("editStats", () => {
  test("never fails and counts identical repeated edits", async () => {
    const edit = (filePath: string, newString: string) => ({ tool: "edit", status: "completed", input: { filePath, oldString: "a", newString } })
    const tools = [edit("src/a.ts", "b"), edit("src/a.ts", "b"), edit("src/a.ts", "c"), edit("src/b.ts", "d"), { tool: "read", status: "completed", input: { filePath: "src/a.ts" } }]
    const graded = await editStats().grade(context({ tools }))
    expect(graded.pass).toBe(true)
    expect(graded.detail).toBe("4 edit(s), 2 file(s), 1 identical repeat(s), max 3 on src/a.ts")
    expect((await editStats().grade(context())).detail).toBe("0 edit(s), 0 file(s), 0 identical repeat(s), max 0 on -")
  })
})
