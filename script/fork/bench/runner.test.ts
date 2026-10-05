import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  NO_USER_ANSWER,
  answerPermissions,
  answerQuestions,
  countWatchdogRecoveries,
  createIdleDebounce,
  managedProcessesBusy,
  permissionsInfo,
} from "./runner"

describe("answerQuestions", () => {
  test("replies to every pending question with one answer per sub-question", async () => {
    const replies: unknown[] = []
    const client = {
      question: {
        list: async () => ({ data: [{ id: "q1", questions: [{}, {}] }, { id: "q2" }] }),
        reply: async (input: unknown) => {
          replies.push(input)
          return {}
        },
      },
    }
    await answerQuestions(client as never)
    expect(replies).toEqual([
      { requestID: "q1", answers: [[NO_USER_ANSWER], [NO_USER_ANSWER]] },
      { requestID: "q2", answers: [[NO_USER_ANSWER]] },
    ])
  })

  test("a failing list never breaks the run", async () => {
    const client = { question: { list: async () => Promise.reject(new Error("down")), reply: async () => ({}) } }
    await expect(answerQuestions(client as never)).resolves.toBe(0)
  })
})

describe("answerPermissions", () => {
  test("allows every pending permission once and records what was asked", async () => {
    const replies: unknown[] = []
    const client = {
      permission: {
        list: async () => ({ data: [{ id: "p1", permission: "bash", patterns: ["ls -la"] }, { id: "p2", permission: "edit", patterns: ["a.ts"] }] }),
        reply: async (input: unknown) => {
          replies.push(input)
          return {}
        },
      },
    }
    const seen = new Map<string, string>()
    expect(await answerPermissions(client as never, seen)).toBe(2)
    // the same request seen on a second poll is counted once
    await answerPermissions(client as never, seen)
    expect(replies.slice(0, 2)).toEqual([{ requestID: "p1", reply: "once" }, { requestID: "p2", reply: "once" }])
    expect([...seen.values()]).toEqual(["bash: ls -la", "edit: a.ts"])
    expect(permissionsInfo(seen)).toEqual({ name: "info:permissions", pass: true, detail: "2 permission wait(s), auto-approved once: bash: ls -la; edit: a.ts" })
  })

  test("a failing list never breaks the run", async () => {
    const client = { permission: { list: async () => Promise.reject(new Error("down")), reply: async () => ({}) } }
    await expect(answerPermissions(client as never, new Map())).resolves.toBe(0)
    expect(permissionsInfo(new Map()).detail).toBe("0 permission wait(s), auto-approved once")
  })
})

describe("createIdleDebounce", () => {
  test("done only after staying quiet for the whole window; any busy poll restarts it", () => {
    let clock = 0
    const quiet = createIdleDebounce(5000, () => clock)
    expect(quiet.settled(true)).toBe(false)
    clock = 2000
    expect(quiet.settled(true)).toBe(false)
    clock = 4000
    expect(quiet.settled(false)).toBe(false)
    clock = 6000
    expect(quiet.settled(true)).toBe(false)
    clock = 10_000
    expect(quiet.settled(true)).toBe(false)
    clock = 11_000
    expect(quiet.settled(true)).toBe(true)
  })
})

describe("managedProcessesBusy", () => {
  let dir = ""
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  function registry(entries: unknown[]): string {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), "bench-proc-"))
    mkdirSync(join(dir, ".omo", "proc"), { recursive: true })
    writeFileSync(join(dir, ".omo", "proc", "processes.json"), JSON.stringify(entries))
    return dir
  }

  test("busy while a process runs untold or a notice is pending; a ready server or a finished process is not", () => {
    expect(managedProcessesBusy(registry([{ status: "running", told: false }]))).toBe(true)
    expect(managedProcessesBusy(registry([{ status: "exited", told: true, noticePending: true }]))).toBe(true)
    expect(managedProcessesBusy(registry([{ status: "running", told: true }, { status: "exited", told: true }]))).toBe(false)
  })

  test("no registry or a broken one is not busy", () => {
    expect(managedProcessesBusy(join(tmpdir(), "bench-proc-missing"))).toBe(false)
    expect(managedProcessesBusy(registry([]))).toBe(false)
    writeFileSync(join(dir, ".omo", "proc", "processes.json"), "{")
    expect(managedProcessesBusy(dir)).toBe(false)
  })
})

describe("countWatchdogRecoveries", () => {
  test("counts only the watchdog's stall recoveries", () => {
    const log = [
      "[2026-10-05T10:00:00Z] [stall-watchdog] main session stalled {\"sessionID\":\"a\"}",
      "[2026-10-05T10:00:01Z] [stall-watchdog] continuation dispatched {}",
      "[2026-10-05T10:01:00Z] [stall-watchdog] subagent stalled; its owner will retry {}",
      "[2026-10-05T10:02:00Z] [stall-watchdog] main session ended on a stream timeout {}",
      "[2026-10-05T10:03:00Z] [managed-process] session notified {}",
    ].join("\n")
    expect(countWatchdogRecoveries(log)).toBe(3)
    expect(countWatchdogRecoveries("")).toBe(0)
  })
})
