import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  answerMatches,
  citationsExist,
  citesLine,
  saysAbsent,
  contract,
  delegatedTo,
  EXPLORE_CONTRACT,
  outcome,
  ranAs,
  SPECIALIST_CONTRACT,
  toolNotUsed,
  toolUsed,
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

describe("urlsResolve", () => {
  test("a 404 URL fails and a 200 passes", async () => {
    const fetchStatus = async (url: string) => (url.includes("missing") ? 404 : 200)
    const ok = await urlsResolve().grade(context({ answer: "https://a.dev/ok" }, { fetchStatus }))
    const bad = await urlsResolve().grade(context({ answer: "https://a.dev/ok and https://a.dev/missing." }, { fetchStatus }))
    expect(ok.pass).toBe(true)
    expect(bad.pass).toBe(false)
    expect(bad.detail).toContain("https://a.dev/missing")
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
