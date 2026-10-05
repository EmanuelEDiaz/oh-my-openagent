import { randomBytes } from "node:crypto"
import { closeSync, fsyncSync, openSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs"

const TOLERATED_FSYNC_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "ENOTSUP", "EINVAL"])
const WINDOWS_RENAME_RETRIES = 4

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Write-then-rename with a per-writer temp name (`<path>.tmp-<pid>-<random>`), so a process killed mid-write never
 * leaves a truncated `boulder.json` and two writers never share a temp file (fork roadmap 0.15). Zero dependencies on
 * purpose: this package stays dependency-free.
 */
export function writeFileAtomically(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`
  try {
    writeFileSync(tempPath, content, "utf-8")
    const descriptor = openSync(tempPath, "r+")
    try {
      fsyncSync(descriptor)
    } catch (error) {
      if (!TOLERATED_FSYNC_CODES.has(errorCode(error) ?? "")) throw error
    } finally {
      closeSync(descriptor)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tempPath, filePath)
        break
      } catch (error) {
        const code = errorCode(error)
        if (process.platform !== "win32" || !(code === "EPERM" || code === "EACCES" || code === "EBUSY")) throw error
        if (attempt < WINDOWS_RENAME_RETRIES) {
          sleepSync(25 * (attempt + 1))
          continue
        }
        unlinkSync(filePath)
        renameSync(tempPath, filePath)
        break
      }
    }
  } finally {
    rmSync(tempPath, { force: true })
  }
}
