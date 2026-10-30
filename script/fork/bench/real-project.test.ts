import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { recordVerdict, saveArbiterPackage } from "./arbiter"
import { commandGrader, defectRecall } from "./command-grader"
import { loadLocalSuites } from "./local-suites"
import type { GradeContext, RunResult, Transcript } from "./types"

const scratch = mkdtempSync(join(tmpdir(), "bench-real-project-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function transcript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    agent: "sisyphus",
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

function context(workdir: string, overrides: Partial<Transcript> = {}): GradeContext {
  return { transcript: transcript(overrides), workdir }
}

function gitRepo(name: string, files: Record<string, string>): string {
  const dir = join(scratch, name)
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: dir })
  git("init", "-q")
  git("add", "-A")
  git("commit", "-qm", "fixture")
  return dir
}

describe("commandGrader", () => {
  test("#given a command that exits 0 in the workdir #then it passes", async () => {
    const workdir = gitRepo("cmd-pass", { "a.txt": "x" })
    const grade = await commandGrader({ name: "outcome:ls", command: ["sh", "-c", "test -f a.txt"], timeoutMs: 10_000 }).grade(context(workdir))
    expect(grade).toEqual({ name: "outcome:ls", pass: true })
  })

  test("#given a failing command #then it fails with the tail of its output", async () => {
    const workdir = gitRepo("cmd-fail", { "a.txt": "x" })
    const grade = await commandGrader({ name: "outcome:build", command: ["sh", "-c", "echo first; echo BUILD FAILED >&2; exit 3"], timeoutMs: 10_000 }).grade(context(workdir))
    expect(grade.pass).toBe(false)
    expect(grade.detail).toContain("exit 3")
    expect(grade.detail).toContain("BUILD FAILED")
  })

  test("#given a subdirectory and extra env #then the command runs there with that env", async () => {
    const workdir = gitRepo("cmd-cwd", { "backend/pom.xml": "<project/>" })
    const grade = await commandGrader({ name: "outcome:env", command: ["sh", "-c", 'test -f pom.xml && test "$DB_PORT" = 5433'], cwd: "backend", env: { DB_PORT: "5433" }, timeoutMs: 10_000 }).grade(context(workdir))
    expect(grade.pass).toBe(true)
  })

  test("#given a command that outlives its timeout #then it fails as a timeout", async () => {
    const workdir = gitRepo("cmd-timeout", { "a.txt": "x" })
    const grade = await commandGrader({ name: "outcome:slow", command: ["sleep", "5"], timeoutMs: 300 }).grade(context(workdir))
    expect(grade.pass).toBe(false)
    expect(grade.detail).toContain("timed out")
  })
})

describe("defectRecall", () => {
  const defects = [
    { id: "transfer-button", patterns: [/nueva transferencia/i] },
    { id: "customer-required", patterns: [/cliente.*obligatori/i, /customer.*required/i] },
    { id: "no-suppliers", patterns: [/proveedor/i] },
  ]

  test("#given a report naming 2 of 3 reference defects #when the bar is 0.6 #then it passes and lists the missed one", async () => {
    const workdir = gitRepo("defects", { "docs/audit.md": "- El botón Nueva transferencia no abre nada\n- En ventas el cliente es obligatorio\n" })
    const grade = await defectRecall({ report: "docs/audit.md", defects, minRecall: 0.6 }).grade(context(workdir))
    expect(grade.pass).toBe(true)
    expect(grade.detail).toContain("2/3")
    expect(grade.detail).toContain("missed: no-suppliers")
  })

  test("#given no report file #then it fails", async () => {
    const workdir = gitRepo("defects-missing", { "a.txt": "x" })
    const grade = await defectRecall({ report: "docs/audit.md", defects, minRecall: 0.5 }).grade(context(workdir))
    expect(grade.pass).toBe(false)
    expect(grade.detail).toContain("not found")
  })
})

describe("loadLocalSuites", () => {
  test("#given private suite folders #then it loads each suite.ts with its own output folder and skips the rest", async () => {
    const root = join(scratch, "private")
    mkdirSync(join(root, "inv"), { recursive: true })
    mkdirSync(join(root, "no-suite"), { recursive: true })
    writeFileSync(join(root, "inv/suite.ts"), 'export const SUITES = { "inv-audit": [{ id: "inv/audit-1" }] }\n')
    const suites = await loadLocalSuites(root, ["explore"])
    expect(Object.keys(suites)).toEqual(["inv-audit"])
    expect(suites["inv-audit"]?.outDir).toBe(join(root, "inv"))
    expect(suites["inv-audit"]?.tasks.map((task) => task.id)).toEqual(["inv/audit-1"])
  })

  test("#given a private suite reusing a built-in name #then it refuses", async () => {
    const root = join(scratch, "private-clash")
    mkdirSync(join(root, "x"), { recursive: true })
    writeFileSync(join(root, "x/suite.ts"), 'export const SUITES = { explore: [] }\n')
    await expect(loadLocalSuites(root, ["explore"])).rejects.toThrow("explore")
  })

  test("#given no private folder #then there are no local suites", async () => {
    expect(await loadLocalSuites(join(scratch, "absent"), [])).toEqual({})
  })
})

describe("arbiter", () => {
  test("#given the agent changed and added files #then the package keeps the diff, its answer and the grades", () => {
    const workdir = gitRepo("arb-work", { "src/a.ts": "one\n" })
    writeFileSync(join(workdir, "src/a.ts"), "two\n")
    writeFileSync(join(workdir, "src/a.test.ts"), "test\n")
    const out = join(scratch, "arb-out")
    const dir = saveArbiterPackage(out, "inv_audit-r0-a0", workdir, transcript({ answer: "Informe listo" }))
    const diff = readFileSync(join(dir, "diff.patch"), "utf8")
    expect(diff).toContain("-one")
    expect(diff).toContain("+two")
    expect(diff).toContain("src/a.test.ts")
    expect(readFileSync(join(dir, "answer.md"), "utf8")).toBe("Informe listo")
  })

  test("#given a raw results file #then a verdict is recorded on the matching run only", () => {
    const file = join(scratch, "runs.jsonl")
    const runs: RunResult[] = [
      { taskId: "inv/a", repeat: 0, attempt: 0, pass: true, grades: [] },
      { taskId: "inv/a", repeat: 1, attempt: 0, pass: true, grades: [] },
    ]
    writeFileSync(file, `${runs.map((run) => JSON.stringify(run)).join("\n")}\n`)
    recordVerdict(file, "inv/a", 1, "fail", "the new test asserts the current behaviour, not the contract")
    const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as RunResult)
    expect(lines[0]?.arbiter).toBeUndefined()
    expect(lines[1]?.arbiter?.verdict).toBe("fail")
    expect(lines[1]?.arbiter?.reason).toContain("contract")
  })

  test("#given no run matches #then recording a verdict throws", () => {
    const file = join(scratch, "runs-none.jsonl")
    writeFileSync(file, `${JSON.stringify({ taskId: "inv/a", repeat: 0, attempt: 0, grades: [] })}\n`)
    expect(() => recordVerdict(file, "inv/b", 0, "pass", "ok")).toThrow("inv/b")
  })
})
