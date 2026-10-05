import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadInterruption } from "./store"
import { isLowMemory, orphanReason, probableCause, readWipMarkers, recoverOrphans, staleHeartbeatMs, wipDir, writeWipMarker, type OrphanCheck, type WipMarker } from "./wip-marker"

const dirs: string[] = []
const project = () => {
  const path = mkdtempSync(join(tmpdir(), "omo-wip-"))
  dirs.push(path)
  return path
}
afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

const NOW = 1_000_000_000
const thresholds = { lowMemoryMb: 700, lowMemoryRatio: 0.1 }

function marker(overrides: Partial<WipMarker> = {}): WipMarker {
  return {
    pid: 4242,
    startedAt: 100,
    startSource: "proc",
    bootId: "boot-a",
    heartbeat: NOW - 10_000,
    sessions: [{ sessionID: "ses_main", messageID: "msg_1", openTools: [{ callID: "c1", tool: "bash", summary: "npm test" }], subtasks: ["ses_child"] }],
    memory: { availableMb: 3000, totalMb: 8000 },
    oomKills: 2,
    ...overrides,
  }
}

function check(overrides: Partial<OrphanCheck> = {}): OrphanCheck {
  return { now: NOW, ownPid: 1, ownStartedAt: 5, bootId: "boot-a", isAlive: () => true, startTimeOf: () => 100, ...overrides }
}

describe("orphan detection (fork 0.15)", () => {
  test("a live process with a fresh heartbeat is not an orphan", () => {
    expect(orphanReason(marker(), check())).toBeUndefined()
  })

  test("dead pid, reused pid or another boot are orphans", () => {
    expect(orphanReason(marker(), check({ isAlive: () => false }))).toBe("process gone")
    expect(orphanReason(marker(), check({ startTimeOf: () => 999 }))).toBe("pid reused")
    expect(orphanReason(marker(), check({ bootId: "boot-b" }))).toBe("the system restarted")
  })

  test("a live sibling window with the same start time is never an orphan, however old its heartbeat", () => {
    // Window A frozen by lack of RAM: window B starting now must not record A's work as killed.
    expect(orphanReason(marker({ heartbeat: NOW - 3 * 60_000 }), check())).toBeUndefined()
    expect(orphanReason(marker({ heartbeat: NOW - 48 * 60 * 60_000 }), check())).toBeUndefined()
  })

  test("unknown start time and a live pid: kept while silent, an orphan only after a day", () => {
    const windows = marker({ startSource: "plugin", startedAt: NOW - 50_000, heartbeat: NOW - 30 * 60_000 })
    const noProc = check({ startTimeOf: () => undefined, staleHeartbeatMs: staleHeartbeatMs(15) })
    expect(orphanReason(windows, noProc)).toBeUndefined()
    expect(orphanReason({ ...windows, heartbeat: NOW - 25 * 60 * 60_000 }, noProc)).toBe("heartbeat stale")
    // A proc marker whose start time can no longer be read falls back to the same rule.
    expect(orphanReason(marker({ heartbeat: NOW - 30 * 60_000 }), noProc)).toBeUndefined()
  })

  test("the stale threshold follows wip_heartbeat_s, never under 2 min", () => {
    expect(staleHeartbeatMs(15)).toBe(2 * 60_000)
    expect(staleHeartbeatMs(60)).toBe(8 * 60_000)
  })

  test("our own pid is ours only with the same start time", () => {
    expect(orphanReason(marker({ pid: 1, startedAt: 5 }), check())).toBeUndefined()
    expect(orphanReason(marker({ pid: 1, startedAt: 6 }), check())).toBe("pid reused")
    expect(orphanReason(marker({ pid: 1, startSource: "plugin" }), check())).toBe("pid reused")
  })

  test("without /proc (Windows) only liveness and heartbeat count", () => {
    const windows = marker({ startSource: "plugin", startedAt: NOW - 50_000 })
    delete (windows as { bootId?: string }).bootId
    expect(orphanReason(windows, check({ bootId: undefined, startTimeOf: () => undefined }))).toBeUndefined()
    expect(orphanReason(windows, check({ bootId: undefined, isAlive: () => false }))).toBe("process gone")
  })
})

describe("probable cause", () => {
  test("a higher oom_kill count on the same boot means the kernel OOM killer", () => {
    expect(probableCause(marker(), { currentOomKills: 3, sameBoot: true, thresholds }).kind).toBe("oom")
    expect(probableCause(marker(), { currentOomKills: 3, sameBoot: false, thresholds }).kind).toBe("ended")
    const earlyoom = probableCause(marker(), { sameBoot: true, thresholds, earlyoomKilled: true })
    expect(earlyoom.kind).toBe("low-ram")
    expect(earlyoom.es).toContain("earlyoom")
  })

  test("low memory, high PSI or SIGTERM while low means lack of RAM; else the process ended", () => {
    expect(probableCause(marker({ memory: { availableMb: 500, totalMb: 8000 } }), { sameBoot: true, thresholds }).kind).toBe("low-ram")
    expect(probableCause(marker({ memory: { availableMb: 3000, totalMb: 8000, psiFullAvg10: 25 } }), { sameBoot: true, thresholds }).kind).toBe("low-ram")
    expect(probableCause(marker({ sigterm: { at: NOW, lowMemory: true } }), { sameBoot: true, thresholds }).kind).toBe("low-ram")
    expect(probableCause(marker(), { currentOomKills: 2, sameBoot: true, thresholds }).kind).toBe("ended")
  })

  test("isLowMemory uses the MB floor and the ratio", () => {
    expect(isLowMemory({ availableMb: 699, totalMb: 4000 }, thresholds)).toBe(true)
    expect(isLowMemory({ availableMb: 1500, totalMb: 32000 }, thresholds)).toBe(true)
    expect(isLowMemory({ availableMb: 1500, totalMb: 8000 }, thresholds)).toBe(false)
    expect(isLowMemory(undefined, thresholds)).toBe(false)
  })
})

describe("recoverOrphans", () => {
  test("turns an orphaned marker into interruptions with tools and subtasks, then deletes it", () => {
    const dir = project()
    writeWipMarker(dir, marker({ memory: { availableMb: 300, totalMb: 8000 } }))
    writeWipMarker(dir, marker({ pid: 5555, sessions: [{ sessionID: "ses_other", openTools: [], subtasks: [] }] }))

    const recovered = recoverOrphans(dir, { ...check({ isAlive: (pid) => pid === 5555 }), currentOomKills: 2, thresholds })

    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.cause.kind).toBe("low-ram")
    const interruption = loadInterruption(dir, "ses_main")!
    expect(interruption.cause).toBe("killed")
    expect(interruption.detail).toContain("lack of RAM")
    expect(interruption.tools).toEqual([{ callID: "c1", tool: "bash", summary: "npm test" }])
    expect(interruption.subtasks).toEqual(["ses_child"])
    expect(readWipMarkers(dir).map((entry) => entry.pid)).toEqual([5555])
    expect(loadInterruption(dir, "ses_other")).toBeUndefined()
  })

  test("an earlyoom kill counts only after the marker's last heartbeat (an older kill hit a previous owner of the pid)", () => {
    const dir = project()
    writeWipMarker(dir, marker({ memory: { availableMb: 3000, totalMb: 8000 } }))
    const old = recoverOrphans(dir, { ...check({ isAlive: () => false }), currentOomKills: 2, thresholds, earlyoomKills: [{ pid: 4242, at: NOW - 60 * 60_000 }] })
    expect(old[0]!.cause.kind).toBe("ended")

    writeWipMarker(dir, marker({ memory: { availableMb: 3000, totalMb: 8000 } }))
    const fresh = recoverOrphans(dir, { ...check({ isAlive: () => false }), currentOomKills: 2, thresholds, earlyoomKills: [{ pid: 4242, at: NOW - 5_000 }] })
    expect(fresh[0]!.cause.es).toContain("earlyoom")
  })

  test("removes unreadable markers and stale temp files of killed writers", () => {
    const dir = project()
    mkdirSync(wipDir(dir), { recursive: true })
    writeFileSync(join(wipDir(dir), "77.json"), "{ truncated")
    const temp = join(wipDir(dir), "77.json.tmp-77-abc123")
    writeFileSync(temp, "{")
    const old = new Date(NOW - 60 * 60_000)
    utimesSync(temp, old, old)

    expect(recoverOrphans(dir, { ...check(), thresholds })).toEqual([])
    expect(readdirSync(wipDir(dir))).toEqual([])
    expect(existsSync(temp)).toBe(false)
  })
})
