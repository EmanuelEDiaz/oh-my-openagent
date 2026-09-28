import type { KnowledgeKind } from "./types"

/**
 * Higher = more trustworthy/relevant as a source. Measured on real sessions: without weights, tool
 * metadata rows (file paths, commands) outrank the conversation text that explains them.
 */
export const KIND_WEIGHT: Readonly<Record<KnowledgeKind, number>> = {
  decision: 3,
  adr: 3,
  plan: 2.2,
  agents_md: 2,
  changelog: 1.8,
  user: 1.8,
  summary: 1.5,
  assistant: 1.4,
  notepad: 1.4,
  commit: 1.2,
  subagent: 1,
  tool: 0.6,
}

function terms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}

/**
 * Every user term becomes an FTS5 phrase ("planning-log" → "planning-log"), so hyphens, quotes,
 * parentheses or operators in a query can never be parsed as FTS5 syntax.
 */
export function toMatchExpression(query: string, mode: "all" | "any"): string | undefined {
  const quoted = terms(query).map((term) => `"${term.replaceAll('"', '""')}"`)
  if (quoted.length === 0) return undefined
  return quoted.join(mode === "all" ? " " : " OR ")
}

/** bm25() is negative (more negative = better); weight and a small recency boost scale it. */
export function rankScore(bm25: number, kind: KnowledgeKind, updatedAt: number, now: number): number {
  const ageDays = Math.max(0, (now - updatedAt) / 86_400_000)
  const recency = 1 + 0.2 * Math.exp(-ageDays / 90)
  return -bm25 * KIND_WEIGHT[kind] * recency
}
