import { verifyCitation } from "./citations"
import type { CitationContext, EvidenceType } from "./citations"

export type FoundCitation = { readonly type: EvidenceType; readonly ref: string }
export type CitationCheck = { readonly ref: string; readonly ok: boolean; readonly reason?: string }

const FILE_WITH_LINES = /(?<![\w/.-])((?:\.{0,2}\/)?[\w.@-]+(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,10})(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)(?![\w:])/g
const PLAIN_FILE = /(?<![\w/.:-])((?:\.{0,2}\/)?[\w.@-]+(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,10})(?![\w/:#-])/g
const COMMIT = /\bcommit[:\s]+`?([0-9a-f]{7,40})\b/gi
const SESSION = /\b(ses_[A-Za-z0-9]{8,}(?:\/msg_[A-Za-z0-9]+(?:\/prt_[A-Za-z0-9]+)?)?)/g

/**
 * Citations an agent can be held to. Only unambiguous shapes: files need a directory and an extension
 * (so "cache.ts:2" or prose like "e.g." never count), commits need the word "commit", chats the ses_ id.
 */
export function scanCitations(text: string, options: { readonly includePlainFiles?: boolean } = {}): FoundCitation[] {
  const found = new Map<string, FoundCitation>()
  const add = (type: EvidenceType, ref: string): void => {
    if (!found.has(`${type}:${ref}`)) found.set(`${type}:${ref}`, { type, ref })
  }
  for (const match of text.matchAll(FILE_WITH_LINES)) {
    const start = match[2] ?? match[4]
    const end = match[3] ?? match[5]
    if (match[1] && start && !/^https?:/.test(match[1])) add("file", `${match[1]}:${start}${end ? `-${end}` : ""}`)
  }
  if (options.includePlainFiles) {
    for (const match of text.matchAll(PLAIN_FILE)) if (match[1] && !match[1].includes("://")) add("file", match[1])
  }
  for (const match of text.matchAll(COMMIT)) if (match[1]) add("commit", match[1])
  for (const match of text.matchAll(SESSION)) if (match[1]) add("session", match[1])
  return [...found.values()]
}

export function checkCitations(citations: readonly FoundCitation[], context: CitationContext): CitationCheck[] {
  return citations.map((citation) => {
    const result = verifyCitation(citation.type, citation.ref, context)
    return result.ok ? { ref: result.ref, ok: true } : { ref: result.ref, ok: false, reason: result.reason }
  })
}
