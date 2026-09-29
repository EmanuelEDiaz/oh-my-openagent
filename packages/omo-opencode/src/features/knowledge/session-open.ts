import { redactSecrets } from "./session-reader"
import type { SessionPart, SessionReader } from "./session-reader"

const MAX_PART_CHARS = 4000
const MAX_REASONING_CHARS = 2000
const MAX_AROUND = 10

export type ParsedLocator = { readonly sessionId: string; readonly messageId?: string; readonly partId?: string }

export function parseSessionLocator(locator: string): ParsedLocator | undefined {
  const match = /^(ses_[A-Za-z0-9]+)(?:\/(msg_[A-Za-z0-9]+))?(?:\/(prt_[A-Za-z0-9]+))?$/.exec(locator.trim())
  if (!match?.[1]) return undefined
  return { sessionId: match[1], ...(match[2] ? { messageId: match[2] } : {}), ...(match[3] ? { partId: match[3] } : {}) }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[… ${text.length - max} more characters]`
}

function toolLine(part: SessionPart): string {
  let detail = ""
  try {
    const input = JSON.parse(part.toolInput ?? "{}") as Record<string, unknown>
    detail = ["filePath", "path", "command", "pattern", "url", "query"].map((key) => input[key]).find((value) => typeof value === "string") as string ?? ""
  } catch {
    detail = ""
  }
  return `[tool ${part.tool ?? "?"}${detail ? ` ${redactSecrets(detail).slice(0, 200)}` : ""}]`
}

function renderMessage(messageId: string, parts: readonly SessionPart[], cited: ParsedLocator): string {
  const isCitedMessage = messageId === cited.messageId
  const role = parts[0]?.role ?? "?"
  const when = parts[0] ? new Date(parts[0].created).toISOString().replace("T", " ").slice(0, 16) : ""
  const lines = [`${isCitedMessage ? "▶ " : ""}--- ${messageId} [${role}${parts[0]?.summary ? ", compaction summary" : ""}] ${when} ---`]
  for (const part of parts) {
    const mark = part.partId === cited.partId ? `   ◀ cited ${part.partId}` : ""
    if (part.type === "text" && part.text) lines.push(`${part.synthetic ? "[injected] " : ""}${clip(redactSecrets(part.text), MAX_PART_CHARS)}${mark}`)
    else if (part.type === "reasoning" && part.text && isCitedMessage) lines.push(`[reasoning] ${clip(redactSecrets(part.text), MAX_REASONING_CHARS)}${mark}`)
    else if (part.type === "tool") lines.push(`${toolLine(part)}${mark}`)
  }
  return lines.join("\n")
}

/**
 * The original, unsummarized conversation around a citation, read-only from OpenCode's database, so
 * an agent can check what was really said when an index snippet or a compaction summary is not enough.
 */
export function openSessionLocator(reader: SessionReader, locator: string, around = 2): string {
  const cited = parseSessionLocator(locator)
  if (!cited) return `Not a session locator: "${locator}". Expected ses_…/msg_…/prt_… (from knowledge_search).`
  const session = reader.session(cited.sessionId)
  if (!session) return `Session ${cited.sessionId} no longer exists in OpenCode.`
  const messageIds = reader.messageIdsOf(cited.sessionId)
  const index = cited.messageId ? messageIds.indexOf(cited.messageId) : 0
  if (index === -1) return `Message ${cited.messageId} not found in session ${cited.sessionId}.`
  const span = Math.min(Math.max(0, around), MAX_AROUND)
  const window = messageIds.slice(Math.max(0, index - span), index + span + 1)
  return [
    `Session: ${session.title} (${session.id})`,
    `Directory: ${session.directory} · updated ${new Date(session.updated).toISOString().slice(0, 10)}`,
    `Re-audit: opencode run --session ${session.id} --fork`,
    `Showing ${window.length} of ${messageIds.length} messages around the citation (tool outputs omitted).`,
    "",
    ...window.map((messageId) => renderMessage(messageId, reader.partsOfMessage(messageId), cited)),
  ].join("\n\n")
}
