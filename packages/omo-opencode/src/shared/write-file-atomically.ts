import { randomBytes } from "node:crypto"
import {
  chmodSync,
  closeSync,
  type Dirent,
  type fsyncSync as FsyncSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { tolerantFsyncSync } from "./tolerant-fsync"

/** Temporary files are `<path>.tmp-<pid>-<random>`: unique per writer, so two writers never collide (fork 0.15). */
const STALE_TEMP_NAME = /\.tmp-\d+-[0-9a-f]+$/
/** The previous fixed temp name, `<name>.<ext>.tmp`: leftovers of writers killed before the unique names existed. */
const LEGACY_TEMP_NAME = /^.+\.[^.]+\.tmp$/
const WINDOWS_RENAME_RETRIES = 4
const WINDOWS_RENAME_RETRY_MS = 25

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const code = (error as NodeJS.ErrnoException).code
  if (code) return code
  return ["EPERM", "EACCES", "EBUSY"].find((candidate) => error.message.includes(candidate))
}

/** Antivirus and indexers briefly lock files on Windows: retry the rename a few times, then replace the target. */
function renameWithRetry(
  tempPath: string,
  filePath: string,
  platform: NodeJS.Platform,
  rename: (from: string, to: string) => void,
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tempPath, filePath)
      return
    } catch (error) {
      const code = errorCode(error)
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY"
      if (platform !== "win32" || !transient) throw error
      if (attempt < WINDOWS_RENAME_RETRIES) {
        sleepSync(WINDOWS_RENAME_RETRY_MS * (attempt + 1))
        continue
      }
      unlinkSync(filePath)
      rename(tempPath, filePath)
      return
    }
  }
}

export function writeFileAtomically(
  filePath: string,
  content: string,
  deps: {
    fsyncSync?: typeof FsyncSync
    mode?: number
    beforeRenameSync?: (tempPath: string) => void
    platform?: NodeJS.Platform
    renameSync?: (from: string, to: string) => void
  } = {},
): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`
  const mode = deps.mode
  try {
    writeFileSync(tempPath, content, { encoding: "utf-8", mode })
    if (mode !== undefined) {
      chmodSync(tempPath, mode)
    }
    const tempFileDescriptor = openSync(tempPath, "r+")
    try {
      tolerantFsyncSync(tempFileDescriptor, `writeFileAtomically:${filePath}`, deps.fsyncSync)
    } finally {
      closeSync(tempFileDescriptor)
    }

    deps.beforeRenameSync?.(tempPath)
    renameWithRetry(tempPath, filePath, deps.platform ?? process.platform, deps.renameSync ?? renameSync)
  } finally {
    rmSync(tempPath, { force: true })
  }
  if (mode !== undefined) {
    chmodSync(filePath, mode)
  }
}

/**
 * Removes temporary files left behind by writers killed between write and rename (`<name>.tmp-<pid>-<random>`, and
 * the legacy fixed `<name>.<ext>.tmp`).
 * Only files older than `maxAgeMs` go, so a writer still running in another process is never disturbed.
 * Returns how many were removed; never throws.
 */
export function cleanStaleAtomicTempFiles(
  directory: string,
  options: { maxAgeMs?: number; now?: number; recursive?: boolean } = {},
): number {
  const maxAgeMs = options.maxAgeMs ?? 10 * 60_000
  const now = options.now ?? Date.now()
  let entries: Dirent[]
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return 0
  }
  let removed = 0
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (options.recursive) removed += cleanStaleAtomicTempFiles(path, options)
      continue
    }
    if (!STALE_TEMP_NAME.test(entry.name) && !LEGACY_TEMP_NAME.test(entry.name)) continue
    try {
      if (now - statSync(path).mtimeMs < maxAgeMs) continue
      rmSync(path, { force: true })
      removed++
    } catch {
      // raced with another cleaner or with the writer itself
    }
  }
  return removed
}
