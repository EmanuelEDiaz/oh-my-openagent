/** Wires test credentials into OpenCode's tool and shell hooks (fork roadmap 0.21, entrega 2). */
import { spawnSync } from "node:child_process"
import type { PluginInput } from "@opencode-ai/plugin"

import { createCredentialsGuard } from "../../features/credentials/guard"
import { createCredentialStore, type CredentialStore } from "../../features/credentials/store"
import { log } from "../../shared/logger"

function gitDiff(directory: string, includeUnstaged: boolean): string {
  const run = (args: string[]) => spawnSync("git", args, { cwd: directory, encoding: "utf8", timeout: 10_000, maxBuffer: 20_000_000 }).stdout ?? ""
  return run(["diff", "--cached", "-U0", "--no-color"]) + (includeUnstaged ? run(["diff", "-U0", "--no-color"]) : "")
}

export function createCredentialsGuardHook(ctx: PluginInput, store: CredentialStore = createCredentialStore(ctx.directory)) {
  const argsByCall = new Map<string, Record<string, unknown>>()
  const guard = createCredentialsGuard({ directory: ctx.directory, store, stagedDiff: (includeUnstaged) => gitDiff(ctx.directory, includeUnstaged) })
  return {
    store,
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }): Promise<void> => {
      argsByCall.set(input.callID, output.args ?? {})
      if (argsByCall.size > 200) argsByCall.delete(argsByCall.keys().next().value as string)
      await guard.before(input.tool, input.sessionID, input.callID, output.args ?? {})
    },
    "shell.env": async (input: { callID?: string }, output: { env: Record<string, string> }): Promise<void> => {
      const env = guard.shellEnv(input.callID)
      if (Object.keys(env).length > 0) {
        Object.assign(output.env, env)
        log("[credentials] injected saved secrets into the shell", { callID: input.callID, names: Object.keys(env) })
      }
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { title?: string; output?: string; metadata?: Record<string, unknown> },
    ): Promise<void> => {
      const args = input.args ?? argsByCall.get(input.callID) ?? {}
      argsByCall.delete(input.callID)
      await guard.after({ ...input, args }, output)
    },
  }
}
