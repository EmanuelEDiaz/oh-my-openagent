/** Real OpenCode wiring for killed-process recovery and the one-shot resume note (fork roadmap 0.15 C/D). */
import type { ResilienceConfig } from "../../config/schema/resilience"
import { registerManagerForCleanup } from "../background-agent/process-cleanup"
import { sampleMemory } from "../resume/memory-watch"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import type { PluginContext } from "../../plugin/types"
import { isPidAlive, readBootId, readEarlyoomKills, readOomKills, readProcStartTime } from "./process-identity"
import { createInterruptionNotes, type InterruptionNotes, type SessionMessage } from "./resume-note"
import { recordInterruption } from "./store"
import { deleteWipMarker, recoverOrphans, writeWipMarker, type RecoveredOrphan } from "./wip-marker"
import { createWipTracker, type WipTracker } from "./wip-tracker"

const ORPHAN_TOAST_DELAY_MS = 3000

let activeNotes: InterruptionNotes | undefined
let activeTracker: WipTracker | undefined
let sigtermListenerInstalled = false

/** The one-shot note service of the running plugin (read by the chat.message handler). */
export function getInterruptionNotes(): InterruptionNotes | undefined {
  return activeNotes
}

export type PluginResilience = {
  readonly tracker: WipTracker
  readonly notes: InterruptionNotes
  readonly recovered: readonly RecoveredOrphan[]
  onEvent(event: { type: string; properties?: unknown }): void
}

type SessionClient = {
  session: {
    messages(input: { path: { id: string } }): Promise<unknown>
    get(input: { path: { id: string } }): Promise<unknown>
  }
  tui: { showToast(input: { body: { title: string; message: string; variant: "warning"; duration: number } }): Promise<unknown> }
}

async function sessionTitle(client: SessionClient, sessionID: string): Promise<string> {
  const response = await client.session.get({ path: { id: sessionID } }).catch(() => undefined)
  const title = normalizeSDKResponse<{ title?: unknown } | undefined>(response, undefined)?.title
  return typeof title === "string" && title.trim().length > 0 ? `«${title.trim()}»` : sessionID
}

async function toastOrphans(client: SessionClient, recovered: readonly RecoveredOrphan[]): Promise<void> {
  const cut = recovered.flatMap((orphan) => orphan.interruptions.map((interruption) => ({ sessionID: interruption.sessionID, cause: orphan.cause.es })))
  if (cut.length === 0) return
  const titles = await Promise.all(cut.map((entry) => sessionTitle(client, entry.sessionID)))
  const message = cut.length === 1
    ? `La sesión ${titles[0]} se cortó (causa probable: ${cut[0]!.cause}). Escribe cualquier cosa para continuar.`
    : `Se cortaron ${cut.length} sesiones: ${titles.join(", ")} (causa probable: ${cut[0]!.cause}). Escribe cualquier cosa en cada una para continuar.`
  await client.tui.showToast({ body: { title: "Trabajo cortado", message, variant: "warning", duration: 20_000 } }).catch(() => undefined)
}

export function createPluginResilience(ctx: PluginContext, config: Partial<ResilienceConfig> | undefined): PluginResilience | undefined {
  if (config?.enabled === false) return undefined
  const client = ctx.client as unknown as SessionClient
  const projectDir = ctx.directory
  const thresholds = { lowMemoryMb: config?.low_memory_mb ?? 700, lowMemoryRatio: config?.low_memory_ratio ?? 0.1 }
  const procStart = readProcStartTime("self")
  const startedAt = procStart ?? Date.now()
  const startSource = procStart !== undefined ? "proc" as const : "plugin" as const
  const bootId = readBootId()

  const oomKills = readOomKills()
  let recovered: RecoveredOrphan[] = []
  try {
    recovered = recoverOrphans(projectDir, {
      now: Date.now(),
      ownPid: process.pid,
      ...(procStart !== undefined ? { ownStartedAt: procStart } : {}),
      ...(bootId ? { bootId } : {}),
      isAlive: (pid) => isPidAlive(pid),
      startTimeOf: (pid) => readProcStartTime(pid),
      ...(oomKills !== undefined ? { currentOomKills: oomKills } : {}),
      earlyoomKills: readEarlyoomKills(),
      thresholds,
    })
  } catch (error) {
    log("[interruption] orphan scan failed", { error: String(error) })
  }
  if (recovered.length > 0) {
    log("[interruption] recovered killed work", { orphans: recovered.map((orphan) => ({ pid: orphan.marker.pid, reason: orphan.reason, cause: orphan.cause.kind, sessions: orphan.interruptions.length })) })
    // The TUI connects after the plugin loads: give it a moment so the toast is seen.
    setTimeout(() => void toastOrphans(client, recovered), ORPHAN_TOAST_DELAY_MS).unref?.()
  }

  const tracker = createWipTracker({
    pid: process.pid,
    startedAt,
    startSource,
    ...(bootId ? { bootId } : {}),
    heartbeatMs: (config?.wip_heartbeat_s ?? 15) * 1000,
    thresholds,
    sampleMemory,
    readOomKills: () => readOomKills(),
    write: (marker) => writeWipMarker(projectDir, marker),
    remove: () => deleteWipMarker(projectDir, process.pid),
    record: (interruption) => recordInterruption(projectDir, interruption),
    log,
  })
  tracker.start()
  // Ordered shutdown first: its SIGTERM listener exits the process, so ours below never keeps it alive.
  registerManagerForCleanup({ shutdown: () => void tracker.shutdown() })
  activeTracker = tracker
  if (!sigtermListenerInstalled) {
    sigtermListenerInstalled = true
    // Runs before the cleanup listener, so the marker knows about the SIGTERM before shutdown reads it.
    process.prependListener("SIGTERM", () => activeTracker?.onSigterm())
  }

  const notes = createInterruptionNotes({
    projectDir,
    fetchMessages: async (sessionID) => normalizeSDKResponse<SessionMessage[]>(await client.session.messages({ path: { id: sessionID } }), []),
    log,
  })
  activeNotes = notes

  return {
    tracker,
    notes,
    recovered,
    onEvent(event) {
      tracker.onEvent(event)
      notes.onEvent(event)
    },
  }
}
