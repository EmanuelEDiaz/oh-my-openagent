/** Real OpenCode wiring for lossless resume (fork roadmap 0.8c). */
import { isMainThread } from "node:worker_threads"

import type { ResumeConfig } from "../../config/schema/resume"
import { registerManagerForCleanup } from "../background-agent/process-cleanup"
import { opencodeDbPath } from "../knowledge/service"
import { openSessionReader } from "../knowledge/session-reader"
import { getStallWatchdog } from "../stall-watchdog"
import { log } from "../../shared/logger"
import { resolveSessionTarget } from "../../shared/session-target"
import type { PluginContext } from "../../plugin/types"
import { createResumeService, type ResumeService } from "./service"
import { registerRetentionDirectory } from "./retention"

let active: ResumeService | undefined

export function getActiveResumeService(): ResumeService | undefined {
  return active
}

export function createPluginResumeService(ctx: PluginContext, config: Partial<ResumeConfig> | undefined): ResumeService {
  const service = createResumeService({
    projectDir: ctx.directory,
    openReader: () => openSessionReader(opencodeDbPath()),
    target: (sessionID) => resolveSessionTarget(ctx.client as never, sessionID),
    toast: async (message) => {
      await ctx.client.tui.showToast({ body: { title: "Work saved", message, variant: "warning", duration: 15_000 } }).catch(() => undefined)
    },
    // Only sessions that were working: an idle conversation is already safe in OpenCode's database.
    activeSessions: () => getStallWatchdog()?.busySessions() ?? [],
    memory: {
      processLimitBytes: (config?.memory_limit_mb ?? 1228) * 1024 * 1024,
      systemUsedRatio: (config?.system_memory_percent ?? 85) / 100,
      intervalMs: config?.memory_check_interval_ms ?? 30_000,
    },
    log,
  })
  service.start()
  registerRetentionDirectory(ctx.directory)
  // Ordered shutdown: the plugin's cleanup waits for every registered manager before exiting.
  registerManagerForCleanup({ shutdown: () => service.saveOnShutdown() })
  log("[resume] service started", { directory: ctx.directory, mainThread: isMainThread, pid: process.pid, sigtermListeners: process.listenerCount("SIGTERM") })
  active = service
  return service
}
