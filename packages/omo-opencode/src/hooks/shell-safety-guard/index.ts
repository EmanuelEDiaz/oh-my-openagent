/** Wires the shell safety guard into OpenCode's tool hooks (fork roadmap 0.21, entrega 1). */
import { readFileSync, statSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"

import { getActiveProcessManager } from "../../features/managed-process"
import { createShellSafetyGuard } from "../../features/shell-safety/guard"
import { protectedProcesses, readProcStat } from "../../features/shell-safety/process-context"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { log } from "../../shared/logger"
import { createSessionRootResolver } from "../../shared/session-root"

/** Scripts and .sql files bigger than this are not read (a dump is not a migration the agent wrote). */
const MAX_SCRIPT_BYTES = 1_000_000

function readSmallFile(path: string): string | undefined {
  try {
    return statSync(path).size <= MAX_SCRIPT_BYTES ? readFileSync(path, "utf8") : undefined
  } catch {
    return undefined
  }
}

export function createShellSafetyGuardHook(ctx: PluginInput) {
  const roots = createSessionRootResolver(ctx)
  // OpenCode and its ancestors do not change while it runs.
  const protectedSet = protectedProcesses(process.pid)
  const argsByCall = new Map<string, Record<string, unknown>>()
  const guard = createShellSafetyGuard({
    directory: ctx.directory,
    readFile: readSmallFile,
    killContext: () => ({
      protectedPids: protectedSet.pids,
      protectedGroups: protectedSet.groups,
      ownedPids: new Set(getActiveProcessManager()?.runningPids() ?? []),
      groupOf: (pid) => readProcStat(pid)?.pgid,
    }),
    rootOf: roots.rootOf,
  })

  return {
    guard,
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }): Promise<void> => {
      argsByCall.set(input.callID, output.args ?? {})
      if (argsByCall.size > 200) argsByCall.delete(argsByCall.keys().next().value as string)
      try {
        await guard.before(input.tool, input.sessionID, output.args ?? {})
      } catch (error) {
        log("[shell-safety-guard] blocked", { sessionID: input.sessionID, command: output.args?.["command"], reason: String(error).slice(0, 200) })
        throw error
      }
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
    event: async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
      if (event.type !== "session.deleted") return
      const sessionID = resolveSessionEventID(event.properties)
      if (!sessionID) return
      roots.forget(sessionID)
      guard.forgetSession(sessionID)
    },
  }
}
