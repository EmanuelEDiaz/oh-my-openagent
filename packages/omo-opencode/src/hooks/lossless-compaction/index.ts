import { contextCollector } from "../../features/context-injector"
import type { ContextCollector } from "../../features/context-injector"
import { buildCompactionSnapshot, formatCompactionGuidance, formatStateCard } from "../../features/knowledge/compaction-snapshot"
import type { CompactionSnapshot } from "../../features/knowledge/compaction-snapshot"
import { opencodeDbPath } from "../../features/knowledge/service"
import { openSessionReader } from "../../features/knowledge/session-reader"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { log } from "../../shared/logger"

export type LosslessCompactionDeps = {
  readonly dbPath?: string
  readonly collector?: ContextCollector
}

/**
 * Keeps what matters across compaction without trusting the summary: before compacting, the user's own
 * messages are read from OpenCode's database and handed to the summarizer verbatim with their locators;
 * after compacting, a deterministic state card with whatever the summary did not quote is injected into
 * the next model call.
 */
export function createLosslessCompactionHook(ctx: { readonly directory: string }, deps: LosslessCompactionDeps = {}) {
  const snapshots = new Map<string, CompactionSnapshot>()
  const dbPath = deps.dbPath ?? opencodeDbPath()
  const collector = deps.collector ?? contextCollector

  const snapshotOf = async (sessionID: string): Promise<{ snapshot: CompactionSnapshot; summary: string } | undefined> => {
    const reader = await openSessionReader(dbPath)
    if (reader === null) return undefined
    try {
      return { snapshot: snapshots.get(sessionID) ?? buildCompactionSnapshot(reader, sessionID, ctx.directory), summary: reader.latestSummaryText(sessionID) }
    } finally {
      reader.close()
    }
  }

  return {
    capture: async (sessionID: string): Promise<void> => {
      const reader = await openSessionReader(dbPath)
      if (reader === null) return
      try {
        snapshots.set(sessionID, buildCompactionSnapshot(reader, sessionID, ctx.directory))
      } finally {
        reader.close()
      }
    },
    inject: (sessionID: string): string | undefined => {
      const snapshot = snapshots.get(sessionID)
      const guidance = snapshot ? formatCompactionGuidance(snapshot) : ""
      return guidance.length > 0 ? guidance : undefined
    },
    event: async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
      if (event.type !== "session.compacted") return
      const sessionID = resolveSessionEventID(event.properties as Record<string, unknown> | undefined)
      if (!sessionID) return
      const state = await snapshotOf(sessionID)
      snapshots.delete(sessionID)
      if (!state) return
      const card = formatStateCard(state.snapshot, state.summary)
      if (card.length === 0) return
      collector.register(sessionID, { id: "lossless-compaction", source: "custom", content: card, priority: "high" })
      log("[lossless-compaction] state card registered", { sessionID, chars: card.length })
    },
  }
}
