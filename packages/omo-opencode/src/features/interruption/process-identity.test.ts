import { describe, expect, test } from "bun:test"

import { earlyoomLogPath, isPidAlive, parseProcStartTime, readBootId, readEarlyoomKills, readOomKills, readProcStartTime } from "./process-identity"

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
    expect([...readEarlyoomKills("/log", () => "123 opencode\n\n456 bun 2026-10-05\nbad line\n")]).toEqual([123, 456])
    expect(readEarlyoomKills("/log", () => { throw new Error("ENOENT") }).size).toBe(0)
  })
})
