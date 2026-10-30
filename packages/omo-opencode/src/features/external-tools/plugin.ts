import { log } from "../../shared/logger"
import { cachedCheck } from "./cache"
import type { CheckDeps } from "./check"
import { createCheckDeps } from "./real-deps"
import { startupNotice } from "./report"

type ToastClient = { tui: { showToast(input: { body: { title: string; message: string; variant: "warning"; duration: number } }): Promise<unknown> } }

/** The check starts shortly after load, so it does not compete with startup. */
const CHECK_DELAY_MS = 4000
/**
 * A toast sent before the TUI listens is lost (QA 21-10-2026: the instance was still booting 6 s after the plugin
 * loaded). The notice waits for the first sign of the TUI, a session or message event, and goes out at this time at
 * the latest.
 */
const NOTICE_FALLBACK_MS = 30_000
const TUI_ACTIVITY = /^(session|message|tui|command)\./

/** Runs the cached check and returns the startup notice, or undefined when every needed tool works. */
export async function externalToolsNotice(input: { directory: string; deps?: CheckDeps; cacheFile?: string }): Promise<string | undefined> {
  const started = Date.now()
  const reports = await cachedCheck(input.directory, input.deps ?? createCheckDeps(), input.cacheFile ? { file: input.cacheFile } : {})
  log("[external-tools] startup check", { directory: input.directory, ms: Date.now() - started, tools: reports.map((report) => `${report.tool.id}:${report.status}`) })
  return startupNotice(reports)
}

export type ExternalToolsNotice = {
  /** Feed every plugin event: the first sign of the TUI releases a pending notice. */
  onEvent(event: { type: string }): void
  /** Resolves once the notice was shown, or when there was nothing to show. */
  readonly done: Promise<void>
}

/**
 * At OpenCode startup, in the background (fork roadmap 0.25): checks the tools the open project needs (cached) and,
 * only if one is missing or does not connect, shows a toast once the TUI is listening. Nothing reaches the prompt.
 */
export function createExternalToolsNotice(
  directory: string,
  client: ToastClient,
  options: { deps?: CheckDeps; cacheFile?: string; checkDelayMs?: number; fallbackMs?: number } = {},
): ExternalToolsNotice {
  let notice: string | undefined
  let tuiSeen = false
  let shown = false
  let finish = () => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })

  const show = (reason: string): void => {
    if (shown || notice === undefined) return
    shown = true
    log("[external-tools] notice shown", { directory, reason })
    void client.tui
      .showToast({ body: { title: "Herramientas externas", message: notice, variant: "warning", duration: 20_000 } })
      .catch(() => undefined)
      .finally(finish)
  }

  setTimeout(() => {
    externalToolsNotice({ directory, ...(options.deps ? { deps: options.deps } : {}), ...(options.cacheFile ? { cacheFile: options.cacheFile } : {}) })
      .then((result) => {
        notice = result
        if (notice === undefined) return finish()
        if (tuiSeen) return show("tui already active")
        setTimeout(() => show("fallback"), options.fallbackMs ?? NOTICE_FALLBACK_MS).unref?.()
      })
      .catch((error) => {
        log("[external-tools] startup check failed", { error: String(error) })
        finish()
      })
  }, options.checkDelayMs ?? CHECK_DELAY_MS).unref?.()

  return {
    onEvent(event) {
      if (shown || !TUI_ACTIVITY.test(event.type)) return
      tuiSeen = true
      show(`first ${event.type}`)
    },
    done,
  }
}
