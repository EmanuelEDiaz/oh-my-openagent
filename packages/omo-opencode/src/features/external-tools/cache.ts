import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { checkExternalTools, projectLanguages, toolsFor, type CheckDeps, type ToolReport, type ToolStatus } from "./check"
import { EXTERNAL_TOOLS } from "./inventory"

/**
 * The startup notice must not start language servers on every launch (fork 0.25): the result is reused while the
 * binaries found (path and modification time) and the project's TypeScript stay the same, for at most a day.
 */
type CachedEntry = { readonly fingerprint: string; readonly at: number; readonly reports: readonly { readonly id: string; readonly status: ToolStatus; readonly detail: string }[] }

const MAX_AGE_MS = 24 * 60 * 60 * 1000

export function externalToolsCacheFile(env: NodeJS.ProcessEnv = process.env): string {
  const cache = env["XDG_CACHE_HOME"]?.trim() || join(env["HOME"]?.trim() || homedir(), ".cache")
  return join(cache, "oh-my-opencode", "external-tools.json")
}

function mtime(path: string | null): string {
  if (path === null) return "-"
  try {
    return `${path}@${statSync(path).mtimeMs}`
  } catch {
    return `${path}@?`
  }
}

/** What the result depends on: each needed tool's binary, and the project's own TypeScript package. */
export function fingerprint(projectDir: string, deps: Pick<CheckDeps, "which">): string {
  const tools = toolsFor(projectLanguages(projectDir), false)
  const binaries = tools.map((tool) => {
    const commands = tool.check.kind === "command" ? [tool.check.command] : tool.check.servers.map((server) => server.command[0] ?? "")
    return commands.map((command) => mtime(deps.which(command, projectDir))).join(",")
  })
  return [...binaries, mtime(join(projectDir, "node_modules", "typescript", "package.json"))].join("|")
}

function readCache(file: string): Record<string, CachedEntry> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, CachedEntry>
  } catch {
    return {}
  }
}

export async function cachedCheck(projectDir: string, deps: CheckDeps, options: { file?: string; now?: () => number } = {}): Promise<ToolReport[]> {
  const file = options.file ?? externalToolsCacheFile()
  const now = options.now ?? Date.now
  const key = fingerprint(projectDir, deps)
  const all = readCache(file)
  const entry = all[projectDir]
  if (entry && entry.fingerprint === key && now() - entry.at < MAX_AGE_MS) {
    return entry.reports.flatMap((report) => {
      const tool = EXTERNAL_TOOLS.find((candidate) => candidate.id === report.id)
      return tool ? [{ tool, status: report.status, detail: report.detail }] : []
    })
  }
  const reports = await checkExternalTools(projectDir, deps, { includeOptional: false })
  all[projectDir] = { fingerprint: key, at: now(), reports: reports.map((report) => ({ id: report.tool.id, status: report.status, detail: report.detail })) }
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(all, null, 2))
  } catch {
    // A cache that cannot be written only costs a recheck next time.
  }
  return reports
}
