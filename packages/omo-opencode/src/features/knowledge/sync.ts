import { indexGitHistory } from "./index-git"
import { indexProjectFiles } from "./index-files"
import type { KnowledgeStore } from "./store"

export type SyncStats = { readonly filesIndexed: number; readonly commitsIndexed: number; readonly ms: number }

export type SyncOptions = {
  readonly store: KnowledgeStore
  readonly projectDir: string
  readonly includePaths?: readonly string[]
  readonly gitCommits?: number
}

export async function syncProject(options: SyncOptions): Promise<SyncStats> {
  const started = Date.now()
  const filesIndexed = await indexProjectFiles(options.store, options.projectDir, options.includePaths ?? [])
  const commitsIndexed = await indexGitHistory(options.store, options.projectDir, options.gitCommits ?? 500)
  options.store.maintain({ now: Date.now() })
  return { filesIndexed, commitsIndexed, ms: Date.now() - started }
}
