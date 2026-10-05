/**
 * Interruptions (fork roadmap 0.15): work that was cut by a network loss, a freeze or a killed process and not
 * resumed yet. The next user message of the session, whatever its text, carries a one-shot note built from it; the
 * entry is deleted only after that message went out, so a second cut does not lose it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "../../shared/write-file-atomically"

export type InterruptionCause = "network" | "freeze" | "killed" | "stall"

export type InterruptedTool = {
  readonly callID: string
  readonly tool: string
  /** Short form of the input (command, file path…) for the note. */
  readonly summary: string
}

export type Interruption = {
  readonly sessionID: string
  readonly cause: InterruptionCause
  /** One line for the user and the model, e.g. "no connection for 12 min" or "process killed (probably low RAM)". */
  readonly detail: string
  readonly at: number
  readonly tools?: readonly InterruptedTool[]
  readonly subtasks?: readonly string[]
}

function dir(projectDir: string): string {
  return join(projectDir, ".omo", "runs", "interruptions")
}

function file(projectDir: string, sessionID: string): string {
  return join(dir(projectDir), `${sessionID.replace(/[^\w-]/g, "_")}.json`)
}

/** Records (or replaces) the interruption of a session. */
export function recordInterruption(projectDir: string, entry: Interruption): void {
  mkdirSync(dir(projectDir), { recursive: true })
  writeFileAtomically(file(projectDir, entry.sessionID), JSON.stringify(entry, null, 2))
}

export function loadInterruption(projectDir: string, sessionID: string): Interruption | undefined {
  try {
    return JSON.parse(readFileSync(file(projectDir, sessionID), "utf8")) as Interruption
  } catch {
    return undefined
  }
}

export function listInterruptions(projectDir: string): Interruption[] {
  if (!existsSync(dir(projectDir))) return []
  return readdirSync(dir(projectDir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => loadInterruption(projectDir, name.slice(0, -5)))
    .filter((entry): entry is Interruption => entry !== undefined)
}

export function clearInterruption(projectDir: string, sessionID: string): void {
  try {
    unlinkSync(file(projectDir, sessionID))
  } catch {
    // already gone
  }
}
