/**
 * Work-in-progress marker (fork roadmap 0.15): `.omo/runs/wip/<pid>.json`, thin on purpose. It names the busy
 * sessions, their open tool calls and running subagents, who the process is (pid, start time, boot id) and the last
 * memory sample. OpenCode's SQLite stays the source of truth for the conversation; the marker only says "this was
 * being worked on". A marker whose process is gone at the next start is an orphan: the work was killed.
 */
import { mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import { cleanStaleAtomicTempFiles, writeFileAtomically } from "../../shared/write-file-atomically"
import { wasKilledByEarlyoom, type EarlyoomKill } from "./process-identity"
import { recordInterruption, type Interruption, type InterruptedTool } from "./store"

export type WipSession = {
  readonly sessionID: string
  readonly messageID?: string
  readonly openTools: readonly InterruptedTool[]
  readonly subtasks: readonly string[]
}

export type WipMemory = { readonly availableMb: number; readonly totalMb: number; readonly psiFullAvg10?: number }

export type WipMarker = {
  readonly pid: number
  /** Kernel start time of the pid in clock ticks (Linux, `startSource: "proc"`), else the plugin start time in ms. */
  readonly startedAt: number
  readonly startSource: "proc" | "plugin"
  readonly bootId?: string
  readonly heartbeat: number
  readonly sessions: readonly WipSession[]
  readonly memory?: WipMemory
  /** `oom_kill` of `/proc/vmstat` at the last heartbeat: a higher value after the process died means the kernel killed it. */
  readonly oomKills?: number
  /** Set when SIGTERM arrived (earlyoom sends it before SIGKILL). */
  readonly sigterm?: { readonly at: number; readonly lowMemory: boolean }
}

export type LowMemoryThresholds = { readonly lowMemoryMb: number; readonly lowMemoryRatio: number }

/** PSI `full avg10` above this (percent of time every task waited on memory) counts as memory starvation. */
const PSI_FULL_STARVED = 10
export const STALE_HEARTBEAT_MS = 2 * 60_000
/** Unverifiable identity (no /proc start time): a live pid this silent is taken as reused, not as a frozen window. */
export const UNVERIFIED_ALIVE_MAX_MS = 24 * 60 * 60_000

/** Heartbeat age after which a marker counts as silent: 8 missed beats, never under 2 min. */
export function staleHeartbeatMs(heartbeatS: number): number {
  return Math.max(STALE_HEARTBEAT_MS, 8 * heartbeatS * 1000)
}

export function wipDir(projectDir: string): string {
  return join(projectDir, ".omo", "runs", "wip")
}

function wipFile(projectDir: string, pid: number): string {
  return join(wipDir(projectDir), `${pid}.json`)
}

export function writeWipMarker(projectDir: string, marker: WipMarker): void {
  mkdirSync(wipDir(projectDir), { recursive: true })
  writeFileAtomically(wipFile(projectDir, marker.pid), JSON.stringify(marker, null, 2))
}

export function deleteWipMarker(projectDir: string, pid: number): void {
  try {
    unlinkSync(wipFile(projectDir, pid))
  } catch {
    // already gone
  }
}

/** Every readable marker; unreadable files are removed (atomic writes make them leftovers, never live state). */
export function readWipMarkers(projectDir: string): WipMarker[] {
  let names: string[]
  try {
    names = readdirSync(wipDir(projectDir)).filter((name) => /^\d+\.json$/.test(name))
  } catch {
    return []
  }
  const markers: WipMarker[] = []
  for (const name of names) {
    const path = join(wipDir(projectDir), name)
    try {
      const marker = JSON.parse(readFileSync(path, "utf8")) as WipMarker
      if (typeof marker.pid === "number" && Array.isArray(marker.sessions)) markers.push(marker)
    } catch {
      try {
        unlinkSync(path)
      } catch {
        // raced with its writer
      }
    }
  }
  return markers
}

export function isLowMemory(memory: WipMemory | undefined, thresholds: LowMemoryThresholds): boolean {
  if (!memory) return false
  if (memory.psiFullAvg10 !== undefined && memory.psiFullAvg10 > PSI_FULL_STARVED) return true
  if (memory.availableMb < thresholds.lowMemoryMb) return true
  return memory.totalMb > 0 && memory.availableMb / memory.totalMb < thresholds.lowMemoryRatio
}

export type OrphanCheck = {
  readonly now: number
  readonly ownPid: number
  readonly ownStartedAt?: number
  readonly bootId?: string
  readonly isAlive: (pid: number) => boolean
  /** Kernel start time of a live pid (Linux); undefined when unknown. */
  readonly startTimeOf: (pid: number) => number | undefined
  /** Heartbeat age that counts as silent; defaults to {@link STALE_HEARTBEAT_MS} (see {@link staleHeartbeatMs}). */
  readonly staleHeartbeatMs?: number
}

/** Why a marker belongs to dead work, or undefined when its process is (probably) still running it. */
export function orphanReason(marker: WipMarker, check: OrphanCheck): string | undefined {
  if (marker.bootId && check.bootId && marker.bootId !== check.bootId) return "the system restarted"
  if (marker.pid === check.ownPid) {
    // Our own pid: a leftover from a previous process that had the same pid, unless it is literally us.
    return marker.startSource === "proc" && check.ownStartedAt !== undefined && marker.startedAt === check.ownStartedAt ? undefined : "pid reused"
  }
  if (!check.isAlive(marker.pid)) return "process gone"
  const current = marker.startSource === "proc" ? check.startTimeOf(marker.pid) : undefined
  if (current !== undefined) {
    // Verified identity: the same process is alive, however old its heartbeat (a window frozen by lack of RAM, or a
    // sibling window busy elsewhere). Its marker is its own; another window must never record it as killed.
    return current === marker.startedAt ? undefined : "pid reused"
  }
  // Identity unknown (Windows, macOS, or no /proc): only liveness and the heartbeat remain. A silent heartbeat with
  // the pid alive is either a frozen window or a pid reused by another program. Trade-off: a false "killed" deletes a
  // live window's marker and tells the user work was cut while it still runs, which is worse than keeping a dead
  // marker a while longer — and pid reuse within a day is rarer than a frozen window. So a live pid is an orphan only
  // once it has been silent for a day.
  const silentMs = check.now - marker.heartbeat
  const staleMs = check.staleHeartbeatMs ?? STALE_HEARTBEAT_MS
  if (silentMs > Math.max(staleMs, UNVERIFIED_ALIVE_MAX_MS)) return "heartbeat stale"
  return undefined
}

export type ProbableCause = { readonly kind: "oom" | "low-ram" | "ended"; readonly en: string; readonly es: string }

export function probableCause(
  marker: WipMarker,
  context: { readonly currentOomKills?: number; readonly sameBoot: boolean; readonly thresholds: LowMemoryThresholds; readonly earlyoomKilled?: boolean },
): ProbableCause {
  if (context.earlyoomKilled) {
    return { kind: "low-ram", en: "earlyoom killed OpenCode for lack of RAM", es: "earlyoom lo cerró por falta de RAM" }
  }
  if (context.sameBoot && marker.oomKills !== undefined && context.currentOomKills !== undefined && context.currentOomKills > marker.oomKills) {
    return { kind: "oom", en: "the kernel OOM killer ended OpenCode (out of memory)", es: "el kernel lo cerró por falta de memoria (OOM)" }
  }
  if (marker.sigterm?.lowMemory || isLowMemory(marker.memory, context.thresholds)) {
    return { kind: "low-ram", en: "OpenCode was killed, probably for lack of RAM (earlyoom or similar)", es: "probablemente por falta de RAM" }
  }
  return { kind: "ended", en: "the OpenCode process ended while working", es: "el proceso de OpenCode terminó" }
}

export type RecoveredOrphan = { readonly marker: WipMarker; readonly reason: string; readonly cause: ProbableCause; readonly interruptions: readonly Interruption[] }

/**
 * Turns every orphaned marker into one interruption per session (tools and subtasks included) and deletes it.
 * Also removes temp files of writers killed mid-write in the project state we own. Never throws.
 */
export function recoverOrphans(
  projectDir: string,
  check: OrphanCheck & { readonly currentOomKills?: number; readonly thresholds: LowMemoryThresholds; readonly earlyoomKills?: readonly EarlyoomKill[] },
): RecoveredOrphan[] {
  // Project state we own: boulder.json and ralph-loop state in .omo/, markers under run-continuation/ and runs/.
  cleanStaleAtomicTempFiles(join(projectDir, ".omo"), { now: check.now })
  cleanStaleAtomicTempFiles(join(projectDir, ".omo", "run-continuation"), { now: check.now })
  cleanStaleAtomicTempFiles(join(projectDir, ".omo", "runs"), { recursive: true, now: check.now })
  const recovered: RecoveredOrphan[] = []
  for (const marker of readWipMarkers(projectDir)) {
    const reason = orphanReason(marker, check)
    if (!reason) continue
    const sameBoot = !marker.bootId || !check.bootId || marker.bootId === check.bootId
    const cause = probableCause(marker, {
      ...(check.currentOomKills !== undefined ? { currentOomKills: check.currentOomKills } : {}),
      sameBoot,
      thresholds: check.thresholds,
      earlyoomKilled: sameBoot && wasKilledByEarlyoom(check.earlyoomKills ?? [], marker),
    })
    const interruptions: Interruption[] = []
    for (const session of marker.sessions) {
      const interruption: Interruption = {
        sessionID: session.sessionID,
        cause: "killed",
        detail: cause.en,
        at: marker.sigterm?.at ?? marker.heartbeat,
        ...(session.openTools.length > 0 ? { tools: session.openTools } : {}),
        ...(session.subtasks.length > 0 ? { subtasks: session.subtasks } : {}),
      }
      try {
        recordInterruption(projectDir, interruption)
        interruptions.push(interruption)
      } catch {
        // a read-only project still loses nothing in OpenCode's database
      }
    }
    deleteWipMarker(projectDir, marker.pid)
    recovered.push({ marker, reason, cause, interruptions })
  }
  return recovered
}
