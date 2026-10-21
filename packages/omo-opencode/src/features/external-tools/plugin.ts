import { log } from "../../shared/logger"
import { cachedCheck } from "./cache"
import type { CheckDeps } from "./check"
import { createCheckDeps } from "./real-deps"
import { startupNotice } from "./report"

type ToastClient = { tui: { showToast(input: { body: { title: string; message: string; variant: "warning"; duration: number } }): Promise<unknown> } }

/** The TUI connects after the plugin loads; the check also must not compete with startup. */
const NOTICE_DELAY_MS = 4000

/**
 * At OpenCode startup, in the background (fork roadmap 0.25): checks the tools the open project needs (cached) and,
 * only if one is missing or does not connect, shows a toast. Nothing reaches the model's prompt.
 */
export async function runExternalToolsNotice(input: { directory: string; client: ToastClient; deps?: CheckDeps; cacheFile?: string }): Promise<string | undefined> {
  const started = Date.now()
  const reports = await cachedCheck(input.directory, input.deps ?? createCheckDeps(), input.cacheFile ? { file: input.cacheFile } : {})
  log("[external-tools] startup check", { directory: input.directory, ms: Date.now() - started, tools: reports.map((report) => `${report.tool.id}:${report.status}`) })
  const notice = startupNotice(reports)
  if (notice) await input.client.tui.showToast({ body: { title: "Herramientas externas", message: notice, variant: "warning", duration: 20_000 } }).catch(() => undefined)
  return notice
}

export function scheduleExternalToolsNotice(directory: string, client: ToastClient): void {
  setTimeout(() => {
    void runExternalToolsNotice({ directory, client }).catch((error) => log("[external-tools] startup check failed", { error: String(error) }))
  }, NOTICE_DELAY_MS).unref?.()
}
