/**
 * Rewrites `invalid` results of repairable tool names into a retry instruction and, when the turn still ends right
 * after that result without an answer, sends one internal continuation (fork roadmap 0.15 F).
 */
import { continuationText, parseUnavailableToolError, repairHint, resolveToolName } from "./repair"

type ToolInput = { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> }
type ToolOutput = { title?: string; output?: string; metadata?: Record<string, unknown> }
type HookEvent = { type: string; properties?: unknown }

export type SessionMessagePart = {
  type?: string
  text?: string
  synthetic?: boolean
  tool?: string
  callID?: string
}

export type SessionMessage = {
  info?: { id?: string; role?: string; error?: unknown }
  parts?: SessionMessagePart[]
}

/** Continuations a session may get in a row without a successful tool call in between. */
export const MAX_CONSECUTIVE_CONTINUATIONS = 2
const MAX_REMEMBERED_MESSAGES = 500

export type ToolNameRepairDeps = {
  readonly fetchMessages: (sessionID: string) => Promise<SessionMessage[]>
  readonly continueSession: (sessionID: string, text: string) => Promise<void>
  /** Subagent sessions are collected by their parent on idle: a late prompt there would race the result. */
  readonly isSubagentSession?: (sessionID: string) => boolean
  readonly log?: (message: string, data?: Record<string, unknown>) => void
}

type PendingRepair = { readonly callID: string; readonly badName: string; readonly toolName: string }

/**
 * True when the turn stopped right after the repaired call: no later user message, no later assistant text or tool
 * call, and no error (an abort means the user stopped it).
 */
export function endedAfterCall(messages: readonly SessionMessage[], callID: string): { messageID: string } | undefined {
  const index = messages.findIndex((message) => message.parts?.some((part) => part.type === "tool" && part.callID === callID))
  if (index < 0) return undefined
  const owner = messages[index]!
  if (owner.info?.role !== "assistant" || !owner.info.id || owner.info.error) return undefined
  for (const message of messages.slice(index + 1)) {
    if (message.info?.role !== "assistant" || message.info.error) return undefined
    for (const part of message.parts ?? []) {
      if (part.type === "tool") return undefined
      if (part.type === "text" && !part.synthetic && (part.text ?? "").trim().length > 0) return undefined
    }
  }
  return { messageID: owner.info.id }
}

function sessionIDOf(properties: unknown): string | undefined {
  if (typeof properties !== "object" || properties === null) return undefined
  const record = properties as { sessionID?: unknown; info?: { id?: unknown } }
  if (typeof record.sessionID === "string") return record.sessionID
  return typeof record.info?.id === "string" ? record.info.id : undefined
}

export function createToolNameRepair(deps: ToolNameRepairDeps) {
  const pending = new Map<string, PendingRepair>()
  const consecutive = new Map<string, number>()
  const continuedMessages = new Set<string>()

  function rememberContinued(messageID: string): void {
    continuedMessages.add(messageID)
    if (continuedMessages.size > MAX_REMEMBERED_MESSAGES) {
      const oldest = continuedMessages.values().next().value
      if (oldest !== undefined) continuedMessages.delete(oldest)
    }
  }

  async function onIdle(sessionID: string): Promise<void> {
    const repair = pending.get(sessionID)
    if (!repair) return
    pending.delete(sessionID)
    if (deps.isSubagentSession?.(sessionID)) return
    if ((consecutive.get(sessionID) ?? 0) >= MAX_CONSECUTIVE_CONTINUATIONS) {
      deps.log?.("[tool-name-repair] continuation limit reached", { sessionID })
      return
    }
    const ended = endedAfterCall(await deps.fetchMessages(sessionID), repair.callID)
    if (!ended || continuedMessages.has(ended.messageID)) return
    rememberContinued(ended.messageID)
    consecutive.set(sessionID, (consecutive.get(sessionID) ?? 0) + 1)
    deps.log?.("[tool-name-repair] turn ended after a repaired tool name; continuing once", { sessionID, messageID: ended.messageID, tool: repair.toolName })
    await deps.continueSession(sessionID, continuationText(repair.badName, repair.toolName))
  }

  async function idle(sessionID: string): Promise<void> {
    try {
      await onIdle(sessionID)
    } catch (error) {
      deps.log?.("[tool-name-repair] continuation failed", { sessionID, error: String(error) })
    }
  }

  return {
    "tool.execute.after": async (input: ToolInput, output: ToolOutput | undefined): Promise<void> => {
      if (input.tool !== "invalid") {
        // The model got a real tool through: the session is back on track.
        pending.delete(input.sessionID)
        consecutive.delete(input.sessionID)
        return
      }
      if (!output) return
      const error = typeof input.args?.error === "string" ? input.args.error : output.output ?? ""
      const call = parseUnavailableToolError(error)
      if (!call) return
      const badName = typeof input.args?.tool === "string" ? input.args.tool : call.name
      const toolName = resolveToolName(badName, call.available)
      if (!toolName) return
      output.output = repairHint(badName, toolName)
      output.metadata = { ...output.metadata, toolNameRepair: { from: badName, to: toolName } }
      pending.set(input.sessionID, { callID: input.callID, badName, toolName })
      deps.log?.("[tool-name-repair] repaired tool name", { sessionID: input.sessionID, from: JSON.stringify(badName), to: toolName })
    },
    event: async ({ event }: { event: HookEvent }): Promise<void> => {
      const sessionID = sessionIDOf(event.properties)
      if (!sessionID) return
      if (event.type === "session.deleted") {
        pending.delete(sessionID)
        consecutive.delete(sessionID)
        return
      }
      if (event.type !== "session.idle") return
      // Not awaited: the event chain must not wait on a message fetch and a prompt dispatch.
      void idle(sessionID)
    },
    /** The session.idle work, awaitable (tests). */
    idle,
  }
}

export type ToolNameRepair = ReturnType<typeof createToolNameRepair>
