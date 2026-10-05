/**
 * Keeps the work-in-progress marker of this process current (fork roadmap 0.15): written when a session becomes
 * busy, rewritten when a tool call opens or closes and on every heartbeat, removed when everything is idle. On a
 * shutdown while working the busy sessions become interruptions right away; on SIGKILL the marker stays behind and
 * the next start turns it into interruptions (`recoverOrphans`).
 */
import { getNetworkGuard } from "../network-guard"
import type { MemorySample } from "../resume/memory-watch"
import type { Interruption, InterruptedTool } from "./store"
import { isLowMemory, type LowMemoryThresholds, type WipMarker, type WipMemory, type WipSession } from "./wip-marker"

type TrackerEvent = { type: string; properties?: unknown }

type SessionState = { busy: boolean; messageID?: string; tools: Map<string, InterruptedTool> }

export type WipTrackerDeps = {
  readonly pid: number
  readonly startedAt: number
  readonly startSource: "proc" | "plugin"
  readonly bootId?: string
  readonly heartbeatMs: number
  readonly thresholds: LowMemoryThresholds
  readonly sampleMemory: () => MemorySample
  readonly readOomKills: () => number | undefined
  readonly write: (marker: WipMarker) => void
  readonly remove: () => void
  readonly record?: (interruption: Interruption) => void
  readonly now?: () => number
  readonly log?: (message: string, data?: Record<string, unknown>) => void
  /**
   * The session waits for the network (network guard cycle): its turn ended on the error but the work is still in
   * progress, so it stays in the marker. Defaults to the running network guard.
   */
  readonly isWaiting?: (sessionID: string) => boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function sessionIDOf(properties: unknown): string | undefined {
  const props = record(properties)
  return text(props?.sessionID) ?? text(record(props?.part)?.sessionID) ?? text(record(props?.info)?.sessionID)
}

function clip(value: string, max = 160): string {
  const oneLine = value.replace(/\s+/g, " ").trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

/** Short form of a tool input for the marker and the resume note: the command, the file, the task… */
export function summarizeToolInput(tool: string, input: unknown): string {
  const args = record(input)
  if (!args) return tool
  const preferred = text(args.command) ?? text(args.filePath) ?? text(args.file_path) ?? text(args.path) ?? text(args.description) ?? text(args.pattern) ?? text(args.url)
  if (preferred) return clip(preferred)
  const first = Object.values(args).find((value) => typeof value === "string" && value.length > 0)
  return typeof first === "string" ? clip(first) : tool
}

export function toWipMemory(sample: MemorySample): WipMemory | undefined {
  if (sample.availableBytes === undefined || sample.totalBytes === undefined) return undefined
  return {
    availableMb: Math.round(sample.availableBytes / 1024 ** 2),
    totalMb: Math.round(sample.totalBytes / 1024 ** 2),
    ...(sample.psiFullAvg10 !== undefined ? { psiFullAvg10: sample.psiFullAvg10 } : {}),
  }
}

export function createWipTracker(deps: WipTrackerDeps) {
  const now = deps.now ?? Date.now
  const isWaiting = deps.isWaiting ?? ((sessionID: string) => getNetworkGuard()?.isWaiting(sessionID) ?? false)
  const sessions = new Map<string, SessionState>()
  const parentOf = new Map<string, string>()
  let sigterm: { at: number; lowMemory: boolean } | undefined
  let written: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  function state(sessionID: string): SessionState {
    let current = sessions.get(sessionID)
    if (!current) {
      current = { busy: false, tools: new Map() }
      sessions.set(sessionID, current)
    }
    return current
  }

  function rootOf(sessionID: string): string {
    let current = sessionID
    const seen = new Set<string>()
    while (parentOf.has(current) && !seen.has(current)) {
      seen.add(current)
      current = parentOf.get(current)!
    }
    return current
  }

  /** Busy work grouped by root session: a subagent shows up as a subtask of the session that launched it. */
  function snapshot(): WipSession[] {
    const roots = new Map<string, { subtasks: string[] }>()
    for (const [sessionID, current] of sessions) {
      if (!current.busy && !isWaiting(sessionID)) continue
      const root = rootOf(sessionID)
      const entry = roots.get(root) ?? { subtasks: [] }
      if (root !== sessionID) entry.subtasks.push(sessionID)
      roots.set(root, entry)
    }
    return [...roots].map(([sessionID, entry]) => {
      const current = sessions.get(sessionID)
      return {
        sessionID,
        ...(current?.messageID ? { messageID: current.messageID } : {}),
        openTools: [...(current?.tools.values() ?? [])],
        subtasks: entry.subtasks,
      }
    })
  }

  function marker(work: WipSession[]): WipMarker {
    const memory = toWipMemory(deps.sampleMemory())
    const oomKills = deps.readOomKills()
    return {
      pid: deps.pid,
      startedAt: deps.startedAt,
      startSource: deps.startSource,
      ...(deps.bootId ? { bootId: deps.bootId } : {}),
      heartbeat: now(),
      sessions: work,
      ...(memory ? { memory } : {}),
      ...(oomKills !== undefined ? { oomKills } : {}),
      ...(sigterm ? { sigterm } : {}),
    }
  }

  /** Writes when the work changed (or always, for a heartbeat); removes the marker once nothing is busy. */
  function sync(force = false): void {
    if (stopped) return
    const work = snapshot()
    if (work.length === 0) {
      if (written !== undefined) {
        written = undefined
        try {
          deps.remove()
        } catch (error) {
          deps.log?.("[wip] remove failed", { error: String(error) })
        }
      }
      return
    }
    const key = JSON.stringify([work, sigterm])
    if (!force && key === written) return
    try {
      deps.write(marker(work))
      written = key
    } catch (error) {
      deps.log?.("[wip] write failed", { error: String(error) })
    }
  }

  function setIdle(current: SessionState): void {
    current.busy = false
    current.tools.clear()
    current.messageID = undefined
  }

  const tracker = {
    onEvent(event: TrackerEvent): void {
      const props = record(event.properties)
      if (event.type === "session.created" || event.type === "session.updated") {
        const info = record(props?.info)
        const id = text(info?.id)
        const parentID = text(info?.parentID)
        if (id && parentID) parentOf.set(id, parentID)
        return
      }
      const sessionID = event.type === "session.deleted" ? text(record(props?.info)?.id) ?? sessionIDOf(props) : sessionIDOf(props)
      if (!sessionID) return
      if (event.type === "session.deleted") {
        sessions.delete(sessionID)
        parentOf.delete(sessionID)
        sync()
        return
      }
      if (event.type === "session.idle" || event.type === "session.error") {
        const current = sessions.get(sessionID)
        if (current) setIdle(current)
        sync()
        return
      }
      if (event.type === "session.status") {
        const type = record(props?.status)?.type
        const current = state(sessionID)
        if (type === "idle") setIdle(current)
        else current.busy = true
        sync()
        return
      }
      if (event.type === "message.updated") {
        const info = record(props?.info)
        if (info?.role !== "assistant") return
        const current = state(sessionID)
        if (record(info.time)?.completed === undefined) {
          current.busy = true
          current.messageID = text(info.id) ?? current.messageID
          sync()
        }
        return
      }
      if (event.type === "message.part.updated") {
        const part = record(props?.part)
        if (part?.type !== "tool") return
        const current = state(sessionID)
        const callID = text(part.callID) ?? text(part.id)
        if (!callID) return
        const toolState = record(part.state)
        const status = toolState?.status
        const tool = text(part.tool) ?? "tool"
        if (status === "running" || status === "pending") {
          current.busy = true
          current.tools.set(callID, { callID, tool, summary: summarizeToolInput(tool, toolState?.input) })
        } else {
          current.tools.delete(callID)
        }
        sync()
      }
    },

    start(): void {
      if (timer) return
      timer = setInterval(() => sync(true), deps.heartbeatMs)
      timer.unref?.()
    },

    /** SIGTERM is how earlyoom warns before SIGKILL: remember it in the marker, with whether memory was low. */
    onSigterm(): void {
      sigterm = { at: now(), lowMemory: isLowMemory(toWipMemory(deps.sampleMemory()), deps.thresholds) }
      sync(true)
    },

    /** Orderly shutdown: busy sessions become interruptions now (the marker would only say the same later). */
    shutdown(): Interruption[] {
      if (timer) clearInterval(timer)
      timer = undefined
      const work = snapshot()
      const recorded: Interruption[] = []
      if (work.length > 0 && deps.record) {
        const detail = sigterm?.lowMemory
          ? "OpenCode was closed with SIGTERM while memory was low (probably earlyoom)"
          : sigterm
            ? "OpenCode was closed (SIGTERM) while working"
            : "OpenCode was closed while working"
        for (const session of work) {
          const waiting = !sessions.get(session.sessionID)?.busy && isWaiting(session.sessionID)
          const interruption: Interruption = {
            sessionID: session.sessionID,
            cause: waiting ? "network" : "killed",
            detail: waiting ? "OpenCode was closed while waiting for the network" : detail,
            at: now(),
            ...(session.openTools.length > 0 ? { tools: session.openTools } : {}),
            ...(session.subtasks.length > 0 ? { subtasks: session.subtasks } : {}),
          }
          try {
            deps.record(interruption)
            recorded.push(interruption)
          } catch (error) {
            deps.log?.("[wip] record on shutdown failed", { error: String(error) })
          }
        }
      }
      // Recorded (or nothing busy): the marker has done its job. If recording failed, keep it for the next start.
      if (work.length === 0 || recorded.length === work.length) {
        try {
          deps.remove()
        } catch {
          // the next start treats it as an orphan
        }
      }
      stopped = true
      return recorded
    },

    /** Busy sessions as the marker sees them (for tests and diagnostics). */
    snapshot,
  }
  return tracker
}

export type WipTracker = ReturnType<typeof createWipTracker>

