import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Records why the last comment-checker download failed, so `doctor` can tell "not downloaded yet" from "broken". */
const MARKER = ".download-failed.json"

export type DownloadFailure = { readonly error: string; readonly at: string }

export function recordDownloadFailure(cacheDir: string, error: unknown, now: Date = new Date()): void {
  try {
    mkdirSync(cacheDir, { recursive: true })
    const failure: DownloadFailure = { error: error instanceof Error ? error.message : String(error), at: now.toISOString() }
    writeFileSync(join(cacheDir, MARKER), JSON.stringify(failure))
  } catch {
    // Best effort: the marker only improves the doctor message.
  }
}

export function clearDownloadFailure(cacheDir: string): void {
  rmSync(join(cacheDir, MARKER), { force: true })
}

export function readDownloadFailure(cacheDir: string): DownloadFailure | null {
  const path = join(cacheDir, MARKER)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<DownloadFailure>
    return typeof parsed.error === "string" && typeof parsed.at === "string" ? { error: parsed.error, at: parsed.at } : null
  } catch {
    return null
  }
}
