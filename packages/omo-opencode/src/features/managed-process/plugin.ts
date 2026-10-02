/** Real OpenCode wiring for managed processes (fork roadmap 0.8b): Windows and Linux. */
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { terminateProcessTree } from "@oh-my-opencode/utils/process-tree-termination"
import { bunWhich, resolveGitBashForCurrentProcess, spawn } from "@oh-my-opencode/utils/runtime"

import type { ProcessesConfig } from "../../config/schema/processes"
import { createInternalAgentTextPart } from "../../shared"
import { log } from "../../shared/logger"
import { parseModel, resolveSessionTarget } from "../../shared/session-target"
import { dispatchInternalPrompt } from "../../hooks/shared/prompt-async-gate"
import type { PluginContext } from "../../plugin/types"
import { createProcessManager, type ProcessManager } from "./manager"
import { shellArgv } from "./shell"
import { isPortOpen } from "./wait-for"

let active: ProcessManager | undefined

/** The process manager of this plugin instance, for the stall watchdog (a session waiting on a process is not stalled). */
export function getActiveProcessManager(): ProcessManager | undefined {
  return active
}

function resolveBash(): string | null {
  if (process.platform === "win32") {
    const gitBash = resolveGitBashForCurrentProcess()
    return gitBash.found ? gitBash.path : null
  }
  return bunWhich("bash")
}

export function createPluginProcessManager(ctx: PluginContext, config: Partial<ProcessesConfig> | undefined): ProcessManager {
  const stateDir = join(ctx.directory, ".omo", "proc")
  const bash = resolveBash()
  const exits = new Map<number, Promise<number>>()

  const manager = createProcessManager({
    stateDir,
    platform: process.platform,
    shell: (command) => shellArgv(command, { platform: process.platform, bash, ...(process.env.ComSpec ? { comspec: process.env.ComSpec } : {}) }),
    spawn: (argv, options) => {
      const child = spawn([...argv], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        // Own process group on POSIX so the whole tree can be stopped; Windows stops trees with taskkill /T.
        detached: process.platform !== "win32",
      })
      if (child.pid !== undefined) exits.set(child.pid, child.exited)
      return { pid: child.pid, stdout: child.stdout, stderr: child.stderr, exited: child.exited }
    },
    terminate: async (pid) => {
      const exited = exits.get(pid) ?? Promise.resolve(0)
      const report = await terminateProcessTree(pid, {
        childClosed: exited.then(() => undefined, () => undefined),
        graceMs: 5_000,
        platform: process.platform,
        waitMs: 2_000,
      })
      return { survivorPids: report.survivorPids }
    },
    notify: async (sessionID, text) => {
      const target = await resolveSessionTarget(ctx.client as never, sessionID).catch(() => ({} as { agent?: string; model?: string }))
      const model = target.model ? parseModel(target.model) : undefined
      const result = await dispatchInternalPrompt({
        mode: "async",
        client: ctx.client,
        sessionID,
        source: "managed-process",
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: {
            ...(target.agent ? { agent: target.agent } : {}),
            ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
            parts: [createInternalAgentTextPart(text)],
          },
          query: { directory: ctx.directory },
        },
      })
      log("[managed-process] session notified", { sessionID, status: result.status })
    },
    toast: async (message) => {
      await ctx.client.tui
        .showToast({ body: { title: "Background process", message, variant: "warning", duration: 12_000 } })
        .catch(() => undefined)
    },
    isPortOpen,
    defaultTimeoutMs: config?.timeout_ms ?? 7_200_000,
    setTimer: (fn, ms) => {
      const handle = setTimeout(fn, ms)
      handle.unref?.()
      return handle
    },
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })
  // Logs and the registry are runtime state, never project files.
  const gitignore = join(stateDir, ".gitignore")
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n")
  active = manager
  return manager
}
