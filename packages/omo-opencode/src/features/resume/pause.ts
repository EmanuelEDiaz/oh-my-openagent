/** Pause the work of a session so it can be resumed without losses (fork roadmap 0.8c). */
import {
  getPlanProgress,
  getWorkForSession,
  pauseBoulderWork,
  readCurrentTopLevelTask,
} from "@oh-my-opencode/boulder-state"

import type { CompactionSnapshot } from "../knowledge/compaction-snapshot"
import { captureWip, saveResume, type ResumeCard } from "./store"

export type PauseInput = {
  readonly projectDir: string
  readonly sessionID: string
  /** Why the work stopped, in one line. */
  readonly reason: string
  readonly attempts: ResumeCard["attempts"]
  /** The session's requests, decisions, files and errors (lossless compaction snapshot). */
  readonly snapshot: () => Pick<CompactionSnapshot, "userMessages" | "decisions" | "filesChanged" | "errors"> | undefined
  readonly target: () => Promise<{ agent?: string; model?: string }>
  readonly now?: () => Date
}

/** One card per session: a newer pause replaces the older one. */
export function resumeIdFor(sessionID: string): string {
  return `run_${sessionID.replace(/[^\w-]/g, "_")}`
}

function planOf(projectDir: string, sessionID: string): { workId: string; plan: NonNullable<ResumeCard["plan"]> } | undefined {
  const work = getWorkForSession(projectDir, sessionID)
  if (!work) return undefined
  const progress = getPlanProgress(work.active_plan)
  const current = readCurrentTopLevelTask(work.active_plan)
  return {
    workId: work.work_id,
    plan: {
      path: work.active_plan,
      progress: `${progress.completed}/${progress.total}`,
      ...(current ? { currentTask: `${current.label}. ${current.title}` } : {}),
    },
  }
}

export async function pauseWork(input: PauseInput): Promise<ResumeCard> {
  const id = resumeIdFor(input.sessionID)
  const wip = captureWip(input.projectDir, id)
  const snapshot = (() => {
    try {
      return input.snapshot()
    } catch {
      return undefined
    }
  })()
  const target = await input.target().catch(() => ({} as { agent?: string; model?: string }))
  const planned = (() => {
    try {
      return planOf(input.projectDir, input.sessionID)
    } catch {
      return undefined
    }
  })()
  const card: ResumeCard = {
    id,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
    reason: input.reason,
    sessionID: input.sessionID,
    ...(target.agent ? { agent: target.agent } : {}),
    ...(target.model ? { model: target.model } : {}),
    requests: snapshot?.userMessages ?? [],
    ...(planned ? { plan: planned.plan } : {}),
    decisions: (snapshot?.decisions ?? []).map((decision) => ({ id: decision.id, title: decision.title })),
    filesChanged: snapshot?.filesChanged ?? [],
    errors: snapshot?.errors ?? [],
    attempts: input.attempts,
    ...(wip ? { wip } : {}),
    nextAction: planned?.plan.currentTask
      ? `Continue the plan at: ${planned.plan.currentTask}`
      : "Continue the user's last request from where it stopped.",
  }
  saveResume(input.projectDir, card)
  if (planned) pauseBoulderWork(input.projectDir, planned.workId, { reason: input.reason, resumeId: id })
  return card
}
