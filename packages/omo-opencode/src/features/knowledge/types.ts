/** What a document is; drives ranking weight and the `kinds` filter of knowledge_search. */
export type KnowledgeKind =
  | "decision"
  | "adr"
  | "plan"
  | "agents_md"
  | "notepad"
  | "changelog"
  | "commit"
  | "user"
  | "assistant"
  | "summary"
  | "subagent"
  | "tool"

export type KnowledgeDocument = {
  readonly kind: KnowledgeKind
  /** Unit of incremental re-indexing: a file path, "git", or a session id. */
  readonly source: string
  /** What an agent cites: `path:line`, `commit:<sha>`, or `ses_…/msg_…/prt_…`. */
  readonly locator: string
  readonly title: string
  readonly body: string
  readonly updatedAt: number
  readonly projectId?: string
}

export type KnowledgeHit = {
  readonly kind: KnowledgeKind
  readonly locator: string
  readonly title: string
  readonly snippet: string
  readonly updatedAt: number
  readonly score: number
}
