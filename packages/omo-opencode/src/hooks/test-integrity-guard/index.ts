/** Wires the test-integrity guard into OpenCode's tool and message hooks (fork roadmap 0.9a). */
import type { PluginInput } from "@opencode-ai/plugin"

import { subagentSessions } from "../../features/claude-code-session-state"
import { createTestIntegrityGuard } from "../../features/test-integrity/guard"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { createSessionRootResolver } from "../../shared/session-root"
import { log } from "../../shared/logger"
import { getAgentFromSession } from "../prometheus-md-only/agent-resolution"

export function createTestIntegrityGuardHook(ctx: PluginInput) {
  const roots = createSessionRootResolver(ctx)
  /** Arguments by call, for OpenCode versions that leave them out of tool.execute.after. */
  const argsByCall = new Map<string, Record<string, unknown>>()

  const guard = createTestIntegrityGuard({
    directory: ctx.directory,
    agentOf: async (sessionID) => {
      const agent = await getAgentFromSession(sessionID, ctx.directory, ctx.client).catch(() => undefined)
      return agent ? getAgentConfigKey(agent) : undefined
    },
    rootOf: roots.rootOf,
  })

  return {
    guard,
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      argsByCall.set(input.callID, output.args ?? {})
      if (argsByCall.size > 200) argsByCall.delete(argsByCall.keys().next().value as string)
      await guard.before(input.tool, input.sessionID, input.callID, output.args ?? {})
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { title?: string; output?: string; metadata?: Record<string, unknown> },
    ): Promise<void> => {
      const args = input.args ?? argsByCall.get(input.callID) ?? {}
      argsByCall.delete(input.callID)
      const note = await guard.after({ ...input, args }, output)
      if (note && typeof output.output === "string") output.output += `\n\n${note}`
      else if (note) output.output = note
    },
    "chat.message": async (input: { sessionID: string }): Promise<void> => {
      if (!subagentSessions.has(input.sessionID)) guard.newRequest()
    },
    event: async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
      if (event.type !== "session.deleted") return
      const sessionID = resolveSessionEventID(event.properties)
      if (!sessionID) return
      roots.forget(sessionID)
      guard.forgetSession(sessionID)
      log("[test-integrity-guard] forgot session", { sessionID })
    },
  }
}
