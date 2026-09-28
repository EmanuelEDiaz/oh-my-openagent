import type { KnowledgeHit } from "./types"

function date(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toISOString().slice(0, 10) : "?"
}

export function formatHits(query: string, hits: readonly KnowledgeHit[]): string {
  if (hits.length === 0) {
    return `No indexed project knowledge matches "${query}". Do not assume: search the code (grep/glob), read files, or ask.`
  }
  const lines = hits.flatMap((hit, index) => {
    const entry = [
      `${index + 1}. [${hit.kind}] ${hit.locator} — ${hit.title} (${date(hit.updatedAt)})`,
      `   ${hit.snippet.replace(/\s+/g, " ").trim()}`,
    ]
    if (hit.locator.startsWith("ses_")) {
      const sessionId = hit.locator.split("/")[0]
      entry.push(`   open original: knowledge_open("${hit.locator}") · re-audit: opencode run --session ${sessionId} --fork`)
    }
    return entry
  })
  return [
    ...lines,
    "",
    "Cite the locator (path:line, commit:<sha>, or ses_…/msg_…/prt_…) for any claim you base on these results.",
    "Snippets are excerpts: read the cited file/commit, or knowledge_open a chat locator, before relying on details.",
  ].join("\n")
}
