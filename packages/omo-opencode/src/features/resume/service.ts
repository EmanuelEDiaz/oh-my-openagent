/**
 * Lossless resume service (fork roadmap 0.8c): pauses work with a resume card when retries are spent, when OpenCode
 * receives SIGTERM (e.g. earlyoom) and, ahead of time, when memory runs high; resumes it with `resume_task`.
 */
import { getWorkForSession, selectActiveWork } from "@oh-my-opencode/boulder-state"

import { buildCompactionSnapshot } from "../knowledge/compaction-snapshot"
import { listPaused, loadResume, saveResume, type ResumeCard } from "./store"
import { createMemoryWatch } from "./memory-watch"
import { pauseWork } from "./pause"
import { buildResumePrompt } from "./resume-prompt"
import type { SessionReader } from "../knowledge/session-reader"

export type ResumeServiceDeps = {
  readonly projectDir: string
  readonly openReader: () => Promise<SessionReader | null>
  readonly target: (sessionID: string) => Promise<{ agent?: string; model?: string }>
  readonly toast: (message: string) => Promise<void>
  /** Sessions worth saving when the process is about to die. */
  readonly activeSessions: () => readonly string[]
  readonly memory?: { readonly processLimitBytes: number; readonly systemUsedRatio: number; readonly intervalMs: number; readonly sample?: () => { rss: number; systemUsedRatio: number } }
  readonly log?: (message: string, data?: Record<string, unknown>) => void
}

export function createResumeService(deps: ResumeServiceDeps) {
  let reader: Promise<SessionReader | null> | undefined
  const getReader = () => (reader ??= deps.openReader().catch(() => null))

  async function pause(sessionID: string, reason: string, attempts: ResumeCard["attempts"] = []): Promise<ResumeCard> {
    const opened = await getReader()
    return pauseWork({
      projectDir: deps.projectDir,
      sessionID,
      reason,
      attempts,
      snapshot: () => (opened ? buildCompactionSnapshot(opened, sessionID, deps.projectDir) : undefined),
      target: () => deps.target(sessionID),
    })
  }

  /** Save cards for every active session; never throws. */
  async function pauseActive(reason: string): Promise<number> {
    let saved = 0
    for (const sessionID of new Set(deps.activeSessions())) {
      try {
        await pause(sessionID, reason)
        saved++
      } catch (error) {
        deps.log?.("[resume] pause failed", { sessionID, error: String(error) })
      }
    }
    return saved
  }

  const memoryWatch = deps.memory ? createMemoryWatch(deps.memory) : undefined
  let memoryTimer: ReturnType<typeof setInterval> | undefined

  async function checkMemory(): Promise<void> {
    const crossed = memoryWatch?.check()
    if (!crossed) return
    const saved = await pauseActive(`memory high: ${crossed.reason}`)
    await deps.toast(`${crossed.reason}. The system may close OpenCode to free memory; the current work is saved${saved > 0 ? "" : " (nothing active)"}. Compact the session (/compact) or start a new one; resume later with /omo-resume.`)
  }

  const service = {
    pause,
    pauseActive,

    /** Paused work, or the prompt that resumes one. */
    resume(id?: string, hint?: string): string {
      const paused = listPaused(deps.projectDir)
      if (!id) {
        if (paused.length === 0) return "No paused work in this project."
        return [
          "Paused work (newest first):",
          ...paused.map((card) => `- ${card.id} · ${card.createdAt} · ${card.reason} · next: ${card.nextAction}`),
          "Resume one with resume_task({ id, hint? }).",
        ].join("\n")
      }
      const card = loadResume(deps.projectDir, id)
      if (!card) return `[ERROR] no resume card ${id}; call resume_task without id to list them.`
      const work = getWorkForSession(deps.projectDir, card.sessionID)
      if (work) selectActiveWork(deps.projectDir, work.work_id)
      saveResume(deps.projectDir, { ...card, resumedAt: new Date().toISOString() })
      return buildResumePrompt(deps.projectDir, card, hint)
    },

    start(): void {
      if (!memoryWatch || memoryTimer) return
      memoryTimer = setInterval(() => void checkMemory(), deps.memory!.intervalMs)
      memoryTimer.unref?.()
      registerSigterm(service)
    },

    checkMemory,

    dispose(): void {
      if (memoryTimer) clearInterval(memoryTimer)
      memoryTimer = undefined
      unregisterSigterm(service)
    },
  }
  return service
}

export type ResumeService = ReturnType<typeof createResumeService>

// One SIGTERM handler per process for every plugin instance (the plugin loads once per project directory).
const services = new Set<{ pauseActive(reason: string): Promise<number> }>()
let handlerInstalled = false
const SIGTERM_SAVE_MS = 1500

async function onSigterm(): Promise<void> {
  const saving = Promise.all([...services].map((service) => service.pauseActive("OpenCode received SIGTERM (closed by the system or the user)")))
  await Promise.race([saving, new Promise((resolve) => setTimeout(resolve, SIGTERM_SAVE_MS))])
  // Keep OpenCode's own shutdown if it has one; otherwise end the process as SIGTERM would have.
  if (process.listenerCount("SIGTERM") <= 1) process.exit(143)
}

function registerSigterm(service: { pauseActive(reason: string): Promise<number> }): void {
  services.add(service)
  if (handlerInstalled) return
  handlerInstalled = true
  process.on("SIGTERM", () => void onSigterm())
}

function unregisterSigterm(service: { pauseActive(reason: string): Promise<number> }): void {
  services.delete(service)
}
