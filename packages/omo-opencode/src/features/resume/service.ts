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

const SHUTDOWN_SAVE_MS = 4000
const TARGET_TIMEOUT_MS = 1000

export function createResumeService(deps: ResumeServiceDeps) {
  let reader: Promise<SessionReader | null> | undefined
  const getReader = () => (reader ??= deps.openReader().catch(() => null))

  async function pause(sessionID: string, reason: string, attempts: ResumeCard["attempts"] = [], notes?: string): Promise<ResumeCard> {
    const opened = await getReader()
    return pauseWork({
      projectDir: deps.projectDir,
      sessionID,
      reason,
      attempts,
      snapshot: () => (opened ? buildCompactionSnapshot(opened, sessionID, deps.projectDir) : undefined),
      // During shutdown the server may not answer: never let the card wait on it.
      ...(notes ? { notes } : {}),
      target: () => Promise.race([deps.target(sessionID), new Promise<{ agent?: string; model?: string }>((resolve) => setTimeout(() => resolve({}), TARGET_TIMEOUT_MS))]),
    })
  }

  /** Save cards for every active session; never throws. */
  async function pauseActive(reason: string): Promise<number> {
    let saved = 0
    const sessions = [...new Set(deps.activeSessions())]
    deps.log?.("[resume] saving active sessions", { reason, sessions })
    for (const sessionID of sessions) {
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
    },

    /**
     * Process shutdown (SIGTERM from the OOM guard or a close, SIGINT, exit): runs inside the plugin's ordered cleanup,
     * which waits for it before exiting. Only sessions that were working get a card.
     */
    async saveOnShutdown(): Promise<void> {
      const saving = pauseActive("OpenCode was closed while working (SIGTERM, Ctrl+C or exit)")
      const finished = await Promise.race([saving.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), SHUTDOWN_SAVE_MS))])
      deps.log?.("[resume] shutdown save", { finished })
    },

    checkMemory,

    dispose(): void {
      if (memoryTimer) clearInterval(memoryTimer)
      memoryTimer = undefined
    },
  }
  return service
}

export type ResumeService = ReturnType<typeof createResumeService>
