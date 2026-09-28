/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseCitation, verifyCitation } from "./citations"
import type { SessionReader } from "./session-reader"

let project: string
let sha = ""

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omo-citations-"))
  mkdirSync(join(project, "src"))
  writeFileSync(join(project, "src", "cache.ts"), Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n") + "\n")
  const git = (args: string[]) => execFileSync("git", ["-c", "user.email=qa@x", "-c", "user.name=qa", ...args], { cwd: project, stdio: "pipe" }).toString().trim()
  git(["init", "-q"])
  git(["add", "."])
  git(["commit", "-q", "-m", "init"])
  sha = git(["rev-parse", "HEAD"])
})

afterAll(() => rmSync(project, { recursive: true, force: true }))

const reader = {
  session: (id: string) => (id === "ses_Real00001" ? { id, projectId: "p", parentId: null, directory: "/", title: "t", updated: 1 } : undefined),
  messageIdsOf: () => ["msg_1"],
  partsOfMessage: () => [{ partId: "prt_1" }],
} as unknown as SessionReader

describe("parseCitation", () => {
  test("understands path:line, path:start-end and path#Lstart-Lend", () => {
    // then
    expect(parseCitation("file", "src/a.ts:10")).toEqual({ type: "file", path: "src/a.ts", startLine: 10, endLine: 10 })
    expect(parseCitation("file", "src/a.ts:10-20")).toEqual({ type: "file", path: "src/a.ts", startLine: 10, endLine: 20 })
    expect(parseCitation("file", "src/a.ts#L10-L20")).toEqual({ type: "file", path: "src/a.ts", startLine: 10, endLine: 20 })
    expect(parseCitation("commit", "not-a-sha")).toBeUndefined()
  })
})

describe("verifyCitation", () => {
  const context = () => ({ projectDir: project, sessionReader: reader })

  test("accepts real file lines and fingerprints them", () => {
    // when
    const result = verifyCitation("file", "src/cache.ts:10-12", context())

    // then
    expect(result).toMatchObject({ ok: true, ref: "src/cache.ts:10-12" })
    expect(result.ok && result.fingerprint).toMatch(/^[0-9a-f]{40}$/)
  })

  test("rejects invented lines, files and paths outside the project", () => {
    // then
    expect(verifyCitation("file", "src/cache.ts:500", context())).toEqual({ ok: false, ref: "src/cache.ts:500", reason: "line range out of bounds (the file has 120 lines)" })
    expect(verifyCitation("file", "src/nope.ts:1", context())).toMatchObject({ ok: false, reason: "file does not exist" })
    expect(verifyCitation("file", "/etc/hostname", context())).toMatchObject({ ok: false, reason: "file is outside the project" })
  })

  test("checks commits against the repository", () => {
    // then
    expect(verifyCitation("commit", sha.slice(0, 8), context())).toMatchObject({ ok: true, ref: `commit:${sha.slice(0, 12)}` })
    expect(verifyCitation("commit", "deadbeef", context())).toMatchObject({ ok: false, reason: "commit not found in this repository" })
  })

  test("checks chat citations against OpenCode sessions", () => {
    // then
    expect(verifyCitation("session", "ses_Real00001/msg_1/prt_1", context())).toMatchObject({ ok: true })
    expect(verifyCitation("session", "ses_Fake00001/msg_1", context())).toMatchObject({ ok: false, reason: "session does not exist" })
    expect(verifyCitation("session", "ses_Real00001/msg_9", context())).toMatchObject({ ok: false, reason: "message not found in that session" })
  })

  test("URLs are format-checked only", () => {
    // then
    expect(verifyCitation("url", "https://sqlite.org/fts5.html", context())).toMatchObject({ ok: true })
    expect(verifyCitation("url", "sqlite docs", context())).toMatchObject({ ok: false })
  })
})
