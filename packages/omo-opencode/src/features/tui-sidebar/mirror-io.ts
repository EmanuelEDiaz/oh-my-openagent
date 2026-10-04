import { mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

import { writeFileAtomically } from "../../shared/write-file-atomically"
import { STALE_MS } from "./constants"
import { canonicalProjectDir, mirrorFilePath } from "./mirror-path"
import { parseSnapshot } from "./snapshot-schema"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"

/** Something is in progress: a busy agent, a queued or running job, or a live loop. */
export function snapshotIsActive(snapshot: TuiRuntimeSnapshot): boolean {
  return snapshot.activeAgents.some((agent) => agent.status === "busy" || agent.status === "running" || agent.status === "retry")
    || snapshot.jobBoard.some((job) => job.status === "pending" || job.status === "running")
    || snapshot.loop !== null
}

export function writeMirror(projectDir: string, snapshot: TuiRuntimeSnapshot): void {
  const filePath = mirrorFilePath(projectDir)
  const content = JSON.stringify(snapshot)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileAtomically(filePath, content, { mode: 0o600 })
}

export function readMirror(projectDir: string): TuiRuntimeSnapshot | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(mirrorFilePath(projectDir), "utf-8"))
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }

  const snapshot = parseSnapshot(raw)
  if (snapshot === null) {
    return null
  }
  if (canonicalProjectDir(snapshot.projectDir) !== canonicalProjectDir(projectDir)) {
    return null
  }
  // The server rewrites the mirror while work is in progress; an old "busy" snapshot means it stopped. An idle snapshot
  // is not rewritten (no heartbeat when nothing happens), so its age says nothing.
  if (snapshotIsActive(snapshot) && Date.now() - snapshot.updatedAt > STALE_MS) {
    return null
  }
  return snapshot
}
