/**
 * When an automatic continuation gives up (Atlas plan continuation, todo continuation), the user is told and the work
 * is saved for a lossless resume, instead of only logging it (fork roadmap 0.8c).
 */
import { getActiveResumeService } from "./plugin"

type ToastClient = { tui?: { showToast?: (input: { body: { title: string; message: string; variant: "warning"; duration: number } }) => Promise<unknown> } }

export type WorkStoppedDeps = {
  readonly toast: (message: string) => Promise<void>
  readonly pause?: (sessionID: string, reason: string) => Promise<unknown>
}

export async function reportWorkStopped(sessionID: string, reason: string, deps: WorkStoppedDeps): Promise<void> {
  await deps.pause?.(sessionID, reason).catch(() => undefined)
  await deps.toast(`Automatic continuation stopped: ${reason}. The work is saved; say "reanuda" or run /omo-resume to continue.`).catch(() => undefined)
}

export function reportWorkStoppedWithClient(client: ToastClient, sessionID: string, reason: string): Promise<void> {
  return reportWorkStopped(sessionID, reason, {
    toast: async (message) => {
      await client.tui?.showToast?.({ body: { title: "Work stopped", message, variant: "warning", duration: 15_000 } })
    },
    pause: (id, why) => getActiveResumeService()?.pause(id, why) ?? Promise.resolve(),
  })
}
