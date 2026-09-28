import type { SessionPart, SessionReader, SessionRow } from "./session-reader"
import { redactSecrets } from "./session-reader"
import type { KnowledgeStore } from "./store"
import type { KnowledgeDocument, KnowledgeKind } from "./types"

const SESSION_SOURCE_PREFIX = "session:"
const PINNED_PREFIX = "pinned:"
const MAX_CHUNK_CHARS = 3000
const DAY_MS = 86_400_000
const BUDGET_PRUNE_ROUNDS = 5

export type SessionSyncStats = {
  readonly sessionsIndexed: number
  readonly sessionsRemoved: number
  readonly sessionsSkippedByRetention: number
  readonly sessionsPrunedByBudget: number
}

export type SessionSyncOptions = {
  readonly store: KnowledgeStore
  readonly reader: SessionReader
  readonly now: number
  readonly retentionDays: number
  readonly maxIndexMb: number
}

function textKind(session: SessionRow, part: SessionPart): KnowledgeKind {
  if (part.summary) return "summary"
  if (session.parentId !== null) return "subagent"
  return part.role === "user" ? "user" : "assistant"
}

function toolBody(part: SessionPart): string | undefined {
  if (part.toolInput === null) return undefined
  let input: Record<string, unknown>
  try {
    input = JSON.parse(part.toolInput) as Record<string, unknown>
  } catch {
    return undefined
  }
  const fields = ["filePath", "path", "command", "pattern", "url", "query", "description"]
    .map((key) => input[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.slice(0, 300))
  return fields.length === 0 ? undefined : `${part.tool ?? "tool"} ${fields.join(" ")}`
}

function chunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text]
  const result: string[] = []
  for (let start = 0; start < text.length; start += MAX_CHUNK_CHARS) result.push(text.slice(start, start + MAX_CHUNK_CHARS))
  return result
}

/**
 * Only what people actually said/concluded is indexed: user and final assistant text, compaction
 * summaries, and tool metadata (which file/command). Reasoning, synthetic plugin text and tool outputs
 * are left out; knowledge_open can still show the original message when a summary is not enough.
 */
export function extractSessionDocuments(session: SessionRow, parts: readonly SessionPart[]): KnowledgeDocument[] {
  const documents: KnowledgeDocument[] = []
  for (const part of parts) {
    const locator = `${session.id}/${part.messageId}/${part.partId}`
    const base = { source: `${SESSION_SOURCE_PREFIX}${session.id}`, locator, title: session.title, updatedAt: part.created, projectId: session.projectId }
    if (part.type === "text" && part.text && !part.synthetic) {
      for (const body of chunks(redactSecrets(part.text))) documents.push({ ...base, kind: textKind(session, part), body })
    } else if (part.type === "tool") {
      const body = toolBody(part)
      if (body) documents.push({ ...base, kind: "tool", body: redactSecrets(body) })
    }
  }
  return documents
}

function pinnedSessions(store: KnowledgeStore): Set<string> {
  return new Set(store.listMeta(PINNED_PREFIX).map(([key]) => key.slice(PINNED_PREFIX.length)))
}

/** Remembers sessions cited by plans/decisions so retention and budget pruning never drop them. */
export function pinSessions(store: KnowledgeStore, references: readonly { readonly sessionId: string; readonly source: string }[]): void {
  for (const reference of references) store.setMeta(`${PINNED_PREFIX}${reference.sessionId}`, reference.source)
}

export function syncSessions(options: SessionSyncOptions): SessionSyncStats {
  const { store, reader, now } = options
  const sessions = reader.listSessions()
  const pinned = pinnedSessions(store)
  const live = new Set(sessions.map((session) => `${SESSION_SOURCE_PREFIX}${session.id}`))
  let sessionsIndexed = 0
  let sessionsRemoved = 0
  let sessionsSkippedByRetention = 0

  for (const source of store.listSources(SESSION_SOURCE_PREFIX)) {
    if (!live.has(source)) {
      store.removeSource(source)
      sessionsRemoved++
    }
  }

  for (const session of sessions) {
    const source = `${SESSION_SOURCE_PREFIX}${session.id}`
    const expired = now - session.updated > options.retentionDays * DAY_MS
    if (expired && !pinned.has(session.id)) {
      if (store.sourceHash(source) !== undefined) store.removeSource(source)
      sessionsSkippedByRetention++
      continue
    }
    const hash = String(session.updated)
    if (store.sourceHash(source) === hash) continue
    store.replaceSource(source, hash, extractSessionDocuments(session, reader.partsOf(session.id)))
    sessionsIndexed++
  }

  let sessionsPrunedByBudget = 0
  const budget = options.maxIndexMb * 1_048_576
  store.maintain({ now })
  for (let round = 0; round < BUDGET_PRUNE_ROUNDS && store.stats().bytes > budget; round++) {
    const prunable = sessions
      .filter((session) => !pinned.has(session.id) && store.sourceHash(`${SESSION_SOURCE_PREFIX}${session.id}`) !== undefined)
      .sort((left, right) => left.updated - right.updated)
    const batch = prunable.slice(0, Math.max(1, Math.ceil(prunable.length * 0.1)))
    if (batch.length === 0) break
    for (const session of batch) store.removeSource(`${SESSION_SOURCE_PREFIX}${session.id}`)
    sessionsPrunedByBudget += batch.length
    store.maintain({ now, force: true })
  }

  return { sessionsIndexed, sessionsRemoved, sessionsSkippedByRetention, sessionsPrunedByBudget }
}
