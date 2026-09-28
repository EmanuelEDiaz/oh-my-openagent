import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { KnowledgeStore } from "./store"
import type { KnowledgeDocument } from "./types"

const execFileAsync = promisify(execFile)
const GIT_SOURCE = "git"
const FIELD = "\u001f"
const RECORD = "\u001e"

async function git(projectDir: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectDir, ...args], { maxBuffer: 64_000_000 })
    return stdout
  } catch {
    return null
  }
}

export function parseGitLog(output: string): KnowledgeDocument[] {
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.includes(FIELD))
    .map((record) => {
      const [sha = "", date = "", subject = "", rest = ""] = record.split(FIELD)
      const [body = "", files = ""] = rest.split(FIELD + FIELD)
      const changed = files.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
      return {
        kind: "commit" as const,
        source: GIT_SOURCE,
        locator: `commit:${sha.slice(0, 12)}`,
        title: subject,
        body: [subject, body.trim(), changed.length > 0 ? `files: ${changed.join(" ")}` : ""].filter((part) => part.length > 0).join("\n"),
        updatedAt: Date.parse(date) || 0,
      }
    })
}

/** Indexes the last `limit` commits; skipped entirely while HEAD has not moved. */
export async function indexGitHistory(store: KnowledgeStore, projectDir: string, limit: number): Promise<number> {
  const head = (await git(projectDir, ["rev-parse", "HEAD"]))?.trim()
  if (!head) {
    if (store.sourceHash(GIT_SOURCE) !== undefined) store.removeSource(GIT_SOURCE)
    return 0
  }
  const hash = `${head}:${limit}`
  if (store.sourceHash(GIT_SOURCE) === hash) return 0
  const log = await git(projectDir, [
    "log", `-n${limit}`, "--no-color", `--format=${RECORD}%H${FIELD}%aI${FIELD}%s${FIELD}%b${FIELD}${FIELD}`, "--name-only",
  ])
  if (log === null) return 0
  const documents = parseGitLog(log)
  store.replaceSource(GIT_SOURCE, hash, documents)
  return documents.length
}
