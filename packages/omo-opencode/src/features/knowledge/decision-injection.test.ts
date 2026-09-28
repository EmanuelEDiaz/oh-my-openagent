/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { verifyCitation } from "./citations"
import { decisionsForFile, formatFileDecisions, loadActiveDecisions } from "./decision-injection"

describe("decisions for a file", () => {
  let project: string

  function write(id: string, options: { status?: string; reversibility?: string; date?: string; ref: string; fingerprint?: string; supersededBy?: string }) {
    writeFileSync(join(project, "docs", "decisions", `${id}-x.md`), [
      "---", `id: ${id}`, `title: "Title ${id}"`, `status: ${options.status ?? "active"}`, ...(options.supersededBy ? [`superseded_by: ${options.supersededBy}`] : []),
      `date: ${options.date ?? "2026-09-28"}`, `reversibility: ${options.reversibility ?? "easy"}`, "evidence:", "  - type: file", `    ref: "${options.ref}"`,
      ...(options.fingerprint ? [`    fingerprint: ${options.fingerprint}`] : []), "---", `# ${id}`, "", `- **Decision:** Decision text of ${id}`, "",
    ].join("\n"))
  }

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-decision-injection-"))
    mkdirSync(join(project, "docs", "decisions"), { recursive: true })
    mkdirSync(join(project, "src", "auth"), { recursive: true })
    writeFileSync(join(project, "src", "cache.ts"), "a\nb\nc\n")
    writeFileSync(join(project, "src", "auth", "login.ts"), "x\n")
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  test("matches active decisions citing the file or its directory; superseded ones never appear", () => {
    // given
    write("D-20260901-1", { ref: "src/cache.ts:1", status: "superseded", supersededBy: "D-20260928-1" })
    write("D-20260928-1", { ref: "src/cache.ts:2" })
    write("D-20260928-2", { ref: "src/auth" })

    // when
    const records = loadActiveDecisions(project)

    // then
    expect(decisionsForFile(project, records, "src/cache.ts").map((item) => item.record.id)).toEqual(["D-20260928-1"])
    expect(decisionsForFile(project, records, "src/auth/login.ts").map((item) => item.record.id)).toEqual(["D-20260928-2"])
    expect(decisionsForFile(project, records, "src/other.ts")).toEqual([])
  })

  test("orders hard, then costly, then newest, and caps at three", () => {
    // given
    write("D-20260101-1", { ref: "src/cache.ts", date: "2026-01-01" })
    write("D-20260201-1", { ref: "src/cache.ts", date: "2026-02-01", reversibility: "hard" })
    write("D-20260301-1", { ref: "src/cache.ts", date: "2026-03-01" })
    write("D-20260401-1", { ref: "src/cache.ts", date: "2026-04-01", reversibility: "costly" })

    // then
    expect(decisionsForFile(project, loadActiveDecisions(project), "src/cache.ts").map((item) => item.record.id)).toEqual(["D-20260201-1", "D-20260401-1", "D-20260301-1"])
  })

  test("warns when the cited lines changed since the decision was recorded", () => {
    // given
    const original = verifyCitation("file", "src/cache.ts:2", { projectDir: project })
    write("D-20260928-1", { ref: "src/cache.ts:2", fingerprint: original.ok ? original.fingerprint! : "" })
    writeFileSync(join(project, "src", "cache.ts"), "a\nCHANGED\nc\n")

    // when
    const [item] = decisionsForFile(project, loadActiveDecisions(project), "src/cache.ts")
    const text = formatFileDecisions("src/cache.ts", item ? [item] : [])

    // then
    expect(item?.drift).toBe("cited lines src/cache.ts:2 changed since it was recorded")
    expect(text).toContain("[Decisions for src/cache.ts]")
    expect(text).toContain("Decision: Decision text of D-20260928-1")
    expect(text).toContain("WARNING: cited lines src/cache.ts:2 changed")
  })
})
