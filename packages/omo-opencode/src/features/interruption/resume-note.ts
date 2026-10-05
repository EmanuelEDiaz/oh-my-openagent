/**
 * One-shot resume note (fork roadmap 0.15 D): the next user message of an interrupted session, whatever its text,
 * carries a note for the model: what was cut and why, the last completed step, which steps are done, and the state of
 * every half-done tool. Edits and writes are checked by the plugin against the file on disk (the model is not trusted
 * with it); bash is never repeated blindly. The interruption is cleared only once the message went out, so a second
 * cut before that does not lose it.
 */
import { readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

import { clearInterruption, loadInterruption, type Interruption } from "./store"
import { summarizeToolInput } from "./wip-tracker"

export const INTERRUPTED_WORK_TAG = "<omo-interrupted-work>"

type ToolState = { status?: string; input?: unknown; error?: unknown }
export type SessionToolPart = { type: string; callID?: string; tool?: string; state?: ToolState }
export type SessionMessage = { info?: { role?: string; id?: string; time?: { created?: number } }; parts?: SessionToolPart[] }

export type EditCheck = "applied" | "not-applied" | "differs" | "missing" | "unknown"

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/** Compares an edit/write tool input with the file as it is now. */
export function checkFileTool(
  tool: string,
  input: unknown,
  projectDir: string,
  read: (path: string) => string | undefined = readText,
): { file?: string; check: EditCheck } {
  const args = record(input)
  const rawPath = str(args?.filePath) ?? str(args?.file_path) ?? str(args?.path)
  if (!rawPath) return { check: "unknown" }
  const file = isAbsolute(rawPath) ? rawPath : join(projectDir, rawPath)
  const current = read(file)
  if (tool === "write") {
    const content = str(args?.content)
    if (content === undefined) return { file: rawPath, check: "unknown" }
    if (current === undefined) return { file: rawPath, check: "not-applied" }
    return { file: rawPath, check: current === content ? "applied" : "differs" }
  }
  const oldString = str(args?.oldString) ?? str(args?.old_string)
  const newString = str(args?.newString) ?? str(args?.new_string)
  if (current === undefined) return { file: rawPath, check: "missing" }
  if (oldString === undefined || newString === undefined) return { file: rawPath, check: "unknown" }
  const hasOld = oldString.length > 0 && current.includes(oldString)
  const hasNew = newString.length > 0 ? current.includes(newString) : !hasOld
  if (hasNew && !hasOld) return { file: rawPath, check: "applied" }
  if (hasOld && !hasNew) return { file: rawPath, check: "not-applied" }
  return { file: rawPath, check: "differs" }
}

const CHECK_TEXT: Record<EditCheck, string> = {
  applied: "checked by the plugin: ALREADY APPLIED — do not redo it",
  "not-applied": "checked by the plugin: NOT applied — apply it if the task still needs it",
  differs: "checked by the plugin: the file differs from both the old and the new text — read it before touching it",
  missing: "checked by the plugin: the file does not exist — find out why before recreating it",
  unknown: "could not be checked — read the file before touching it",
}

const ABORTED = /abort|interrupt|cancel/i

function isHalfDone(part: SessionToolPart): boolean {
  const status = part.state?.status
  if (status === "pending" || status === "running") return true
  return status === "error" && ABORTED.test(JSON.stringify(part.state?.error ?? ""))
}

function describe(part: { tool: string; input?: unknown; summary?: string }): string {
  return `${part.tool} ${part.summary ?? summarizeToolInput(part.tool, part.input)}`.trim()
}

/** Tool parts since the last user message (the turn that was cut). */
function cutTurn(messages: readonly SessionMessage[]): SessionToolPart[] {
  let start = 0
  messages.forEach((message, index) => {
    if (message.info?.role === "user") start = index + 1
  })
  return messages.slice(start).flatMap((message) => (message.parts ?? []).filter((part) => part.type === "tool"))
}

function minutesAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  return minutes < 1 ? "just now" : `${minutes} min ago`
}

export function buildResumeNote(input: {
  readonly interruption: Interruption
  readonly messages: readonly SessionMessage[]
  readonly projectDir: string
  readonly now?: number
  readonly readFile?: (path: string) => string | undefined
}): string {
  const { interruption, projectDir } = input
  const now = input.now ?? Date.now()
  const turn = cutTurn(input.messages)
  const byCall = new Map(input.messages.flatMap((message) => message.parts ?? []).filter((part) => part.type === "tool" && part.callID).map((part) => [part.callID!, part]))

  const done = turn.filter((part) => part.state?.status === "completed")
  const lastDone = done.at(-1)
  const halfDone = new Map<string, { tool: string; input?: unknown; summary?: string }>()
  for (const tool of interruption.tools ?? []) {
    halfDone.set(tool.callID, { tool: tool.tool, input: byCall.get(tool.callID)?.state?.input, summary: tool.summary })
  }
  for (const part of turn) {
    if (part.callID && isHalfDone(part) && !halfDone.has(part.callID)) halfDone.set(part.callID, { tool: part.tool ?? "tool", input: part.state?.input })
  }
  // A call that finished after all (its result reached OpenCode before the cut) is done, not half-done.
  for (const callID of [...halfDone.keys()]) {
    if (byCall.get(callID)?.state?.status === "completed") halfDone.delete(callID)
  }

  const lines = [
    INTERRUPTED_WORK_TAG,
    `The previous work in this session was cut ${minutesAgo(interruption.at, now)}: ${interruption.detail} (cause: ${interruption.cause}). The conversation and the files are intact; only the reply being generated at that moment was lost.`,
    lastDone ? `Last completed step: ${describe({ tool: lastDone.tool ?? "tool", input: lastDone.state?.input })}.` : "No step of the cut turn had completed.",
  ]
  if (done.length > 0) {
    lines.push("Already done in the cut turn — do NOT repeat these:")
    for (const part of done.slice(-8)) lines.push(`- ${describe({ tool: part.tool ?? "tool", input: part.state?.input })}`)
    if (done.length > 8) lines.push(`- (and ${done.length - 8} earlier steps)`)
  }
  if (halfDone.size > 0) {
    lines.push("Half-done when it was cut:")
    for (const tool of halfDone.values()) {
      if (tool.tool === "edit" || tool.tool === "write") {
        const { file, check } = checkFileTool(tool.tool, tool.input, projectDir, input.readFile)
        lines.push(`- ${tool.tool} ${file ?? tool.summary ?? ""}: ${CHECK_TEXT[check]}.`.replace(/\s+:/, ":"))
      } else if (tool.tool === "bash") {
        lines.push(`- bash \`${tool.summary ?? summarizeToolInput("bash", tool.input)}\`: never re-run it blindly. First verify whether it already took effect (git status, ls, a quick test), then decide.`)
      } else {
        lines.push(`- ${describe(tool)}: its result is unknown; verify its effect before repeating it.`)
      }
    }
  }
  if (interruption.subtasks && interruption.subtasks.length > 0) {
    lines.push(`Subagents running at the cut: ${interruption.subtasks.join(", ")}. Their work may be partial; check their output (background_output or their session) before launching them again.`)
  }
  lines.push(
    "Rule: if the user's message asks to continue or is ambiguous, resume from the last completed step. If it asks for something else, do that and mention the cut work in one line.",
    "Tell the user they can revert the file changes of a step with OpenCode's /undo (it restores the snapshot taken before the step).",
    "</omo-interrupted-work>",
  )
  return lines.join("\n")
}

export type InterruptionNotesDeps = {
  readonly projectDir: string
  readonly fetchMessages: (sessionID: string) => Promise<SessionMessage[]>
  readonly readFile?: (path: string) => string | undefined
  readonly now?: () => number
  readonly log?: (message: string, data?: Record<string, unknown>) => void
}

export function createInterruptionNotes(deps: InterruptionNotesDeps) {
  /** Interruptions whose note rode on a message that has not been confirmed as sent yet. */
  const pending = new Map<string, number>()

  return {
    /** The note for this session's next user message, or undefined when nothing was cut. */
    async noteFor(sessionID: string): Promise<string | undefined> {
      const interruption = loadInterruption(deps.projectDir, sessionID)
      if (!interruption) return undefined
      const messages = await deps.fetchMessages(sessionID).catch((error) => {
        deps.log?.("[interruption] could not read the session for the note", { sessionID, error: String(error) })
        return [] as SessionMessage[]
      })
      pending.set(sessionID, interruption.at)
      return buildResumeNote({
        interruption,
        messages,
        projectDir: deps.projectDir,
        ...(deps.now ? { now: deps.now() } : {}),
        ...(deps.readFile ? { readFile: deps.readFile } : {}),
      })
    },

    /**
     * The message carrying the note is confirmed once OpenCode stores it (or starts the reply): clear the
     * interruption then — unless a newer cut replaced it meanwhile.
     */
    onEvent(event: { type: string; properties?: unknown }): void {
      if (event.type !== "message.updated" || pending.size === 0) return
      const info = record(record(event.properties)?.info)
      const sessionID = str(info?.sessionID)
      if (!sessionID || !pending.has(sessionID)) return
      if (info?.role !== "user" && info?.role !== "assistant") return
      const at = pending.get(sessionID)
      pending.delete(sessionID)
      if (loadInterruption(deps.projectDir, sessionID)?.at === at) {
        clearInterruption(deps.projectDir, sessionID)
        deps.log?.("[interruption] note delivered; cleared", { sessionID })
      }
    },

    hasPending(sessionID: string): boolean {
      return pending.has(sessionID)
    },
  }
}

export type InterruptionNotes = ReturnType<typeof createInterruptionNotes>
