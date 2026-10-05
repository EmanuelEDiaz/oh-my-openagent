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

/**
 * One replacement against the file as it is now. The new text is looked for first: an insertion's new text contains
 * the old one, so "old text present" alone does not mean "not applied". Occurrences of the old text inside the new
 * text are ignored for the same reason.
 */
function checkReplacement(current: string, oldString: string, newString: string): EditCheck {
  const hasNew = newString.length > 0 && current.includes(newString)
  const outsideNew = hasNew ? current.split(newString).join("\u0000") : current
  const hasOld = oldString.length > 0 && outsideNew.includes(oldString)
  if (hasNew) return hasOld ? "differs" : "applied"
  if (hasOld) return "not-applied"
  return newString.length === 0 && oldString.length > 0 ? "applied" : "differs"
}

/** Several checks of one tool call: all applied, all not applied, or a mix the model must read. */
function combine(checks: readonly EditCheck[]): EditCheck {
  if (checks.length === 0) return "unknown"
  const first = checks[0]!
  return checks.every((check) => check === first) ? first : "differs"
}

/** Compares an edit/multiedit/write tool input with the file as it is now. */
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
  const edits = tool === "multiedit" && Array.isArray(args?.edits) ? args.edits.map(record) : [args]
  const pairs = edits.map((edit) => ({ oldString: str(edit?.oldString) ?? str(edit?.old_string), newString: str(edit?.newString) ?? str(edit?.new_string) }))
  if (current === undefined) return { file: rawPath, check: "missing" }
  if (pairs.length === 0 || pairs.some((pair) => pair.oldString === undefined || pair.newString === undefined)) return { file: rawPath, check: "unknown" }
  return { file: rawPath, check: combine(pairs.map((pair) => checkReplacement(current, pair.oldString!, pair.newString!))) }
}

type PatchFile = { kind: "add" | "update" | "delete"; path: string; added: string[]; removed: string[]; moved: boolean }

/** `apply_patch` text ("*** Update File: x" sections with +/- lines), or undefined when it cannot be read. */
function parsePatch(patch: string): PatchFile[] | undefined {
  const files: PatchFile[] = []
  for (const line of patch.split("\n")) {
    const header = /^\*\*\* (Add File|Update File|Delete File): (.+)$/.exec(line)
    if (header?.[1] && header[2]) {
      files.push({ kind: header[1] === "Add File" ? "add" : header[1] === "Delete File" ? "delete" : "update", path: header[2].trim(), added: [], removed: [], moved: false })
      continue
    }
    const current = files.at(-1)
    if (!current) continue
    if (line.startsWith("*** Move to:")) current.moved = true
    else if (line.startsWith("***") || line.startsWith("@@")) continue
    else if (line.startsWith("+")) current.added.push(line.slice(1))
    else if (line.startsWith("-")) current.removed.push(line.slice(1))
  }
  return files.length > 0 ? files : undefined
}

function checkPatchFile(entry: PatchFile, current: string | undefined): EditCheck {
  if (entry.moved) return "unknown"
  if (entry.kind === "delete") return current === undefined ? "applied" : "not-applied"
  if (current === undefined) return entry.kind === "add" ? "not-applied" : "missing"
  const lines = new Set(current.split("\n").map((line) => line.trimEnd()))
  // Lines both removed and added (moved or unchanged within the hunk) tell nothing; blank lines neither.
  const added = entry.added.map((line) => line.trimEnd()).filter((line) => line.trim() && !entry.removed.some((removed) => removed.trimEnd() === line))
  const removed = entry.removed.map((line) => line.trimEnd()).filter((line) => line.trim() && !entry.added.some((add) => add.trimEnd() === line))
  if (added.length === 0 && removed.length === 0) return "unknown"
  const addedPresent = added.every((line) => lines.has(line))
  const addedAbsent = added.every((line) => !lines.has(line))
  const removedPresent = removed.every((line) => lines.has(line))
  const removedAbsent = removed.every((line) => !lines.has(line))
  if (addedPresent && removedAbsent) return "applied"
  if (addedAbsent && removedPresent) return "not-applied"
  return "differs"
}

/** Every file of an `apply_patch` call checked on its own; undefined when the patch text is missing or unreadable. */
export function checkPatchTool(
  input: unknown,
  projectDir: string,
  read: (path: string) => string | undefined = readText,
): { file: string; check: EditCheck }[] | undefined {
  const args = record(input)
  const patch = str(args?.patchText) ?? str(args?.patch) ?? str(args?.input)
  const files = patch ? parsePatch(patch) : undefined
  return files?.map((entry) => ({ file: entry.path, check: checkPatchFile(entry, read(isAbsolute(entry.path) ? entry.path : join(projectDir, entry.path))) }))
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
      if (tool.tool === "edit" || tool.tool === "multiedit" || tool.tool === "write") {
        const { file, check } = checkFileTool(tool.tool, tool.input, projectDir, input.readFile)
        lines.push(`- ${tool.tool} ${file ?? tool.summary ?? ""}: ${CHECK_TEXT[check]}.`.replace(/\s+:/, ":"))
      } else if (tool.tool === "apply_patch") {
        const files = checkPatchTool(tool.input, projectDir, input.readFile)
        if (!files) lines.push(`- apply_patch ${tool.summary ?? ""}: ${CHECK_TEXT.unknown}.`.replace(/\s+:/, ":"))
        for (const entry of files ?? []) lines.push(`- apply_patch ${entry.file}: ${CHECK_TEXT[entry.check]}.`)
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
