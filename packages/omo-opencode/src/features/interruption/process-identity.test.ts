import { describe, expect, test } from "bun:test"

import { earlyoomLogPath, isPidAlive, parseProcStartTime, readBootId, readEarlyoomKills, readOomKills, readProcStartTime, wasKilledByEarlyoom } from "./process-identity"

const STAT = "4242 (bun (worker) x) S 1 4242 4242 0 -1 4194560 100 0 0 0 10 5 0 0 20 0 8 0 987654 123456 789"

describe("process identity (fork 0.15)", () => {
  test("reads field 22 of /proc/<pid>/stat even when the command has spaces and parentheses", () => {
    expect(parseProcStartTime(STAT)).toBe(987654)
    expect(parseProcStartTime("1 (x) S 1")).toBeUndefined()
  })

  test("readers return undefined when /proc is missing (Windows, macOS)", () => {
    const missing = () => {
      throw new Error("ENOENT")
    }
    expect(readProcStartTime("self", missing)).toBeUndefined()
    expect(readBootId(missing)).toBeUndefined()
    expect(readOomKills(missing)).toBeUndefined()
  })

  test("reads boot id and the kernel OOM-kill count", () => {
    expect(readBootId(() => "abc-123\n")).toBe("abc-123")
    expect(readOomKills(() => "pgfault 10\noom_kill 3\nfoo 1\n")).toBe(3)
    expect(readOomKills(() => "pgfault 10\n")).toBeUndefined()
    expect(readProcStartTime(4242, (path) => (path === "/proc/4242/stat" ? STAT : ""))).toBe(987654)
  })

  test("ESRCH means gone, EPERM means alive (another user's process)", () => {
    const fail = (code: string) => () => {
      throw Object.assign(new Error(code), { code })
    }
    expect(isPidAlive(1, fail("ESRCH"))).toBe(false)
    expect(isPidAlive(1, fail("EPERM"))).toBe(true)
    expect(isPidAlive(1, () => undefined)).toBe(true)
    expect(isPidAlive(process.pid)).toBe(true)
  })
  test("earlyoom kill log: path from XDG_STATE_HOME or HOME, pids parsed, missing log is empty", () => {
    expect(earlyoomLogPath({ XDG_STATE_HOME: "/s" })).toBe("/s/omo/earlyoom-kills.log")
    expect(earlyoomLogPath({ HOME: "/h" })).toBe("/h/.local/state/omo/earlyoom-kills.log")
    const log = "123 opencode 2026-10-05T10:00:00+02:00\n\n456 bun worker 2026-10-05T11:30:15+02:00\n789 undated\nbad line\n"
    expect(readEarlyoomKills("/log", () => log)).toEqual([
      { pid: 123, at: Date.parse("2026-10-05T10:00:00+02:00") },
      { pid: 456, at: Date.parse("2026-10-05T11:30:15+02:00") },
    ])
    expect(readEarlyoomKills("/log", () => { throw new Error("ENOENT") })).toHaveLength(0)
  })

  test("a logged kill of a reused pid before the marker's heartbeat, or long after it, is not this process", () => {
    const heartbeat = Date.parse("2026-10-05T11:30:00+02:00")
    const kills = [{ pid: 456, at: Date.parse("2026-10-05T09:00:00+02:00") }]
    expect(wasKilledByEarlyoom(kills, { pid: 456, heartbeat })).toBe(false)
    expect(wasKilledByEarlyoom([{ pid: 456, at: heartbeat + 60 * 60_000 }], { pid: 456, heartbeat })).toBe(false)
    // `date -Is` has no milliseconds: a kill logged in the heartbeat's own second still counts.
    expect(wasKilledByEarlyoom([{ pid: 456, at: heartbeat - 500 }], { pid: 456, heartbeat: heartbeat + 0 })).toBe(true)
    expect(wasKilledByEarlyoom([{ pid: 456, at: heartbeat + 20_000 }], { pid: 456, heartbeat })).toBe(true)
    expect(wasKilledByEarlyoom([{ pid: 457, at: heartbeat + 20_000 }], { pid: 456, heartbeat })).toBe(false)
  })
})
