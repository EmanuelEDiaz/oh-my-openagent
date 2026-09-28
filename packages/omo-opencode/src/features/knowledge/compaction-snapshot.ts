import { loadDecisions } from "./decision-files"
import type { SessionReader } from "./session-reader"

const MAX_USER_ITEMS = 12
const MAX_ITEM_CHARS = 400
const MAX_FILES = 15
const MAX_ERRORS = 5
const CARD_BUDGET_CHARS = 4000
const WRITING_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"])

export type SnapshotItem = { readonly locator: string; readonly text: string }

/** Built by code from OpenCode's own records, so it does not depend on what the model chose to summarize. */
export type CompactionSnapshot = {
  readonly sessionId: string
  readonly userMessages: readonly SnapshotItem[]
  readonly decisions: readonly { readonly id: string; readonly title: string; readonly decision?: string; readonly path: string }[]
  readonly filesChanged: readonly string[]
  readonly errors: readonly SnapshotItem[]
}

function clip(text: string, max = MAX_ITEM_CHARS): string {
  const single = text.replace(/\s+/g, " ").trim()
  return single.length <= max ? single : `${single.slice(0, max)}…`
}

function isInjected(text: string): boolean {
  return /^\s*(<system-reminder>|\[SYSTEM|<[a-z-]+-mode>|\[Rule:|\[Decisions for)/i.test(text)
}

export function buildCompactionSnapshot(reader: SessionReader, sessionId: string, projectDir: string): CompactionSnapshot {
  const parts = reader.partsOf(sessionId)
  const seen = new Set<string>()
  const user: SnapshotItem[] = []
  for (const part of parts) {
    if (part.role !== "user" || part.type !== "text" || !part.text || part.synthetic || isInjected(part.text)) continue
    const text = clip(part.text)
    if (seen.has(text)) continue
    seen.add(text)
    user.push({ locator: `${sessionId}/${part.messageId}/${part.partId}`, text })
  }
  const userMessages = user.length <= MAX_USER_ITEMS ? user : [user[0]!, ...user.slice(-(MAX_USER_ITEMS - 1))]

  const files = new Set<string>()
  const errors: SnapshotItem[] = []
  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.tool && WRITING_TOOLS.has(part.tool) && part.toolInput) {
      try {
        const input = JSON.parse(part.toolInput) as Record<string, unknown>
        const path = input["filePath"] ?? input["path"]
        if (typeof path === "string") files.add(path.startsWith(projectDir) ? path.slice(projectDir.length + 1) : path)
      } catch {
        continue
      }
    }
    if (part.toolStatus === "error" && part.toolError) errors.push({ locator: `${sessionId}/${part.messageId}/${part.partId}`, text: clip(`${part.tool}: ${part.toolError}`, 200) })
  }

  const decisions = loadDecisions(projectDir).valid
    .filter((record) => record.session?.startsWith(sessionId) && record.status === "active")
    .map((record) => ({ id: record.id, title: record.title, ...(record.decision ? { decision: record.decision } : {}), path: record.path }))

  return { sessionId, userMessages, decisions, filesChanged: [...files].slice(-MAX_FILES), errors: errors.slice(-MAX_ERRORS) }
}

/** Added to the compaction prompt so the model keeps the user's own words and their locators. */
export function formatCompactionGuidance(snapshot: CompactionSnapshot): string {
  if (snapshot.userMessages.length === 0) return ""
  return [
    "## Lossless compaction: preserve these user messages VERBATIM in the summary (requests and constraints), each with its locator:",
    ...snapshot.userMessages.map((item) => `- [${item.locator}] ${item.text}`),
  ].join("\n")
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9áéíóúñü]+/g, " ").trim()
}

/**
 * Deterministic state card injected after compaction: what the user literally asked (unless the summary
 * already quotes it), decisions, files changed and errors, each with a locator for knowledge_open.
 */
export function formatStateCard(snapshot: CompactionSnapshot, summaryText: string): string {
  const summary = normalized(summaryText)
  const missing = snapshot.userMessages.filter((item) => !summary.includes(normalized(item.text).slice(0, 120)))
  const sections: string[] = []
  if (missing.length > 0) {
    sections.push("User messages (verbatim; not quoted in the summary):", ...missing.map((item) => `- "${item.text}" [${item.locator}]`))
  }
  if (snapshot.decisions.length > 0) {
    sections.push("Decisions recorded in this session:", ...snapshot.decisions.map((item) => `- ${item.id}: ${item.title}${item.decision ? ` — ${clip(item.decision, 160)}` : ""} (${item.path})`))
  }
  if (snapshot.filesChanged.length > 0) sections.push(`Files changed: ${snapshot.filesChanged.join(", ")}`)
  if (snapshot.errors.length > 0) sections.push("Tool errors seen:", ...snapshot.errors.map((item) => `- ${item.text} [${item.locator}]`))
  if (sections.length === 0) return ""
  const body = [
    "<compaction-state>",
    "Context was compacted. This card is built from the original conversation; for any detail, knowledge_open(\"<locator>\") returns the exact message.",
    ...sections,
    "</compaction-state>",
  ].join("\n")
  return body.length <= CARD_BUDGET_CHARS ? body : `${body.slice(0, CARD_BUDGET_CHARS - 40)}\n…(truncated)\n</compaction-state>`
}
