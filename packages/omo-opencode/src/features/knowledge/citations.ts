import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

import { parseSessionLocator } from "./session-open"
import type { SessionReader } from "./session-reader"

export type EvidenceType = "file" | "commit" | "url" | "session"

export type Citation =
  | { readonly type: "file"; readonly path: string; readonly startLine?: number; readonly endLine?: number }
  | { readonly type: "commit"; readonly sha: string }
  | { readonly type: "url"; readonly url: string }
  | { readonly type: "session"; readonly sessionId: string; readonly messageId?: string; readonly partId?: string }

export type VerifiedCitation = {
  readonly ok: true
  readonly citation: Citation
  /** Normalized, citable form (`path:10-20`, `commit:<sha12>`, url, `ses_…/msg_…/prt_…`). */
  readonly ref: string
  /** sha1 of the cited lines/file, to detect later drift. */
  readonly fingerprint?: string
}

export type CitationProblem = { readonly ok: false; readonly ref: string; readonly reason: string }

export type CitationContext = {
  readonly projectDir: string
  readonly sessionReader?: SessionReader | null
}

export function parseCitation(type: EvidenceType, ref: string): Citation | undefined {
  const value = ref.trim()
  if (type === "commit") return /^[0-9a-f]{7,40}$/i.test(value.replace(/^commit:/, "")) ? { type, sha: value.replace(/^commit:/, "").toLowerCase() } : undefined
  if (type === "url") return /^https?:\/\/\S+$/i.test(value) ? { type, url: value } : undefined
  if (type === "session") {
    const parsed = parseSessionLocator(value)
    return parsed ? { type, ...parsed } : undefined
  }
  const match = /^(.+?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/.exec(value)
  if (!match?.[1]) return undefined
  const start = Number(match[2] ?? match[4]) || undefined
  const end = Number(match[3] ?? match[5]) || start
  return { type: "file", path: match[1], ...(start ? { startLine: start, endLine: end } : {}) }
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex")
}

function verifyFile(citation: Extract<Citation, { type: "file" }>, context: CitationContext): VerifiedCitation | CitationProblem {
  const ref = `${citation.path}${citation.startLine ? `:${citation.startLine}${citation.endLine && citation.endLine !== citation.startLine ? `-${citation.endLine}` : ""}` : ""}`
  const absolute = isAbsolute(citation.path) ? citation.path : resolve(context.projectDir, citation.path)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return { ok: false, ref, reason: "file does not exist" }
  const inside = relative(realpathSync(context.projectDir), realpathSync(absolute))
  if (inside.startsWith("..") || isAbsolute(inside)) return { ok: false, ref, reason: "file is outside the project" }
  const lines = readFileSync(absolute, "utf-8").split("\n")
  const lineCount = lines.at(-1) === "" ? lines.length - 1 : lines.length
  if (citation.startLine !== undefined) {
    const end = citation.endLine ?? citation.startLine
    if (citation.startLine < 1 || end < citation.startLine || end > lineCount) {
      return { ok: false, ref, reason: `line range out of bounds (the file has ${lineCount} lines)` }
    }
    return { ok: true, citation: { ...citation, path: inside }, ref: ref.replace(citation.path, inside), fingerprint: sha1(lines.slice(citation.startLine - 1, end).join("\n")) }
  }
  return { ok: true, citation: { ...citation, path: inside }, ref: inside, fingerprint: sha1(lines.join("\n")) }
}

function verifyCommit(citation: Extract<Citation, { type: "commit" }>, context: CitationContext): VerifiedCitation | CitationProblem {
  try {
    const full = execFileSync("git", ["-C", context.projectDir, "rev-parse", "--verify", "--quiet", `${citation.sha}^{commit}`], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    return { ok: true, citation: { type: "commit", sha: full }, ref: `commit:${full.slice(0, 12)}` }
  } catch {
    return { ok: false, ref: `commit:${citation.sha}`, reason: "commit not found in this repository" }
  }
}

function verifySession(citation: Extract<Citation, { type: "session" }>, context: CitationContext): VerifiedCitation | CitationProblem {
  const ref = [citation.sessionId, citation.messageId, citation.partId].filter(Boolean).join("/")
  const reader = context.sessionReader
  if (!reader) return { ok: false, ref, reason: "OpenCode session database unavailable, cannot verify" }
  if (!reader.session(citation.sessionId)) return { ok: false, ref, reason: "session does not exist" }
  if (citation.messageId && !reader.messageIdsOf(citation.sessionId).includes(citation.messageId)) return { ok: false, ref, reason: "message not found in that session" }
  if (citation.messageId && citation.partId && !reader.partsOfMessage(citation.messageId).some((part) => part.partId === citation.partId)) {
    return { ok: false, ref, reason: "part not found in that message" }
  }
  return { ok: true, citation, ref }
}

/** Checks that a citation points at something that really exists (URLs are format-checked only). */
export function verifyCitation(type: EvidenceType, rawRef: string, context: CitationContext): VerifiedCitation | CitationProblem {
  const citation = parseCitation(type, rawRef)
  if (!citation) return { ok: false, ref: rawRef, reason: `not a valid ${type} reference` }
  if (citation.type === "file") return verifyFile(citation, context)
  if (citation.type === "commit") return verifyCommit(citation, context)
  if (citation.type === "session") return verifySession(citation, context)
  return { ok: true, citation, ref: citation.url }
}
