/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseProcStat, protectedProcesses } from "./process-context"

describe("what must never be killed", () => {
  test("/proc stat fields survive spaces and parentheses in the command name", () => {
    expect(parseProcStat("500 (bun (opencode) x) S 400 480 470 0 -1")).toEqual({ ppid: 400, pgid: 480, sid: 470 })
  })

  test("OpenCode, every ancestor up to init, its group and its session are protected", () => {
    const table: Record<number, { ppid: number; pgid: number; sid: number }> = {
      500: { ppid: 400, pgid: 480, sid: 470 },
      400: { ppid: 300, pgid: 400, sid: 470 },
      300: { ppid: 1, pgid: 300, sid: 300 },
    }
    const result = protectedProcesses(500, (pid) => table[pid])
    expect([...result.pids].sort((a, b) => a - b)).toEqual([1, 300, 400, 500])
    expect([...result.groups].sort((a, b) => a - b)).toEqual([470, 480])
  })

  test("an unreadable process table still protects OpenCode itself and init", () => {
    const result = protectedProcesses(500, () => undefined)
    expect([...result.pids].sort((a, b) => a - b)).toEqual([1, 500])
  })
})
