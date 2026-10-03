/** Real OpenCode wiring for lossless resume (fork roadmap 0.8c). */
import type { ResumeConfig } from "../../config/schema/resume"
import { getMainSessionID } from "../claude-code-session-state"
import { opencodeDbPath } from "../knowledge/service"
import { openSessionReader } from "../knowledge/session-reader"
import { getStallWatchdog } from "../stall-watchdog"
import { log } from "../../shared/logger"
import { resolveSessionTarget } from "../../shared/session-target"
import type { PluginContext } from "../../plugin/types"
import { createResumeService, type ResumeService } from "./service"

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
    activeSessions: () => [getMainSessionID(), ...(getStallWatchdog()?.busySessions() ?? [])].filter((id): id is string => typeof id === "string"),
    memory: {
      processLimitBytes: (config?.memory_limit_mb ?? 1228) * 1024 * 1024,
      systemUsedRatio: (config?.system_memory_percent ?? 85) / 100,
      intervalMs: config?.memory_check_interval_ms ?? 30_000,
    },
    log,
  })
  service.start()
  active = service
  return service
}
