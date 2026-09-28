import { existsSync } from "node:fs"
import { join } from "node:path"

import * as p from "@clack/prompts"

import { formatReport, inspectOpencodeDb, pinnedIds, vacuumOpencodeDb } from "../features/knowledge/report"
import type { KnowledgeReport } from "../features/knowledge/report"
import { opencodeDbPath } from "../features/knowledge/service"
import { openKnowledgeStore } from "../features/knowledge/store"
import { getDataDir } from "../shared/data-path"

export type KnowledgeReportOptions = {
  readonly cwd?: string
  readonly vacuum?: boolean
  readonly yes?: boolean
  readonly retentionDays?: number
  readonly output?: (line: string) => void
  readonly confirm?: (message: string) => Promise<boolean>
}

async function defaultConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  const answer = await p.confirm({ message, initialValue: false })
  return answer === true
}

async function openIfExists(path: string) {
  return existsSync(path) ? openKnowledgeStore(path) : null
}

export async function runKnowledgeReport(options: KnowledgeReportOptions = {}): Promise<number> {
  const output = options.output ?? console.log
  const projectPath = join(options.cwd ?? process.cwd(), ".omo", "cache", "knowledge.db")
  const sessionPath = join(getDataDir(), "opencode", "omo", "sessions-index.db")
  const project = await openIfExists(projectPath)
  const sessions = await openIfExists(sessionPath)
  try {
    const pinned = pinnedIds(sessions)
    const report: KnowledgeReport = {
      project: project ? { path: projectPath, ...project.stats() } : null,
      sessions: sessions
        ? { path: sessionPath, ...sessions.stats(), sessions: sessions.listSources("session:").length, pinned: pinned.size }
        : null,
      opencodeDb: await inspectOpencodeDb(opencodeDbPath(), pinned, options.retentionDays ?? 180, Date.now()),
    }
    output(formatReport(report))
    if (!options.vacuum) return 0
    if (!report.opencodeDb) {
      output("\nNo OpenCode database found; nothing to vacuum.")
      return 1
    }

    const question = `VACUUM ${report.opencodeDb.path} (${(report.opencodeDb.bytes / 1_048_576).toFixed(0)} MB, ~${(report.opencodeDb.reclaimableBytes / 1_048_576).toFixed(0)} MB reclaimable)? OpenCode must be closed; a backup is written first.`
    const approved = options.yes === true || await (options.confirm ?? defaultConfirm)(question)
    if (!approved) {
      output("\nVACUUM not run (needs confirmation: answer yes, or pass --yes).")
      return 1
    }
    const result = await vacuumOpencodeDb(report.opencodeDb.path)
    if (result.status === "refused") {
      output(`\nVACUUM refused: ${result.reason}`)
      return 1
    }
    output(`\nVACUUM done: ${(result.before / 1_048_576).toFixed(1)} MB -> ${(result.after / 1_048_576).toFixed(1)} MB`)
    output(`Backup kept at ${result.backupPath} (delete it once OpenCode works normally).`)
    return 0
  } finally {
    project?.close()
    sessions?.close()
  }
}
