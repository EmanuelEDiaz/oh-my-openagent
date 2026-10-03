import { pausedWorkGuidance } from "./intent"
import { listPaused } from "./store"

const CACHE_MS = 10_000

/** System-prompt line about paused work, read from disk at most every 10 s (fork roadmap 0.8c). */
export function createPausedWorkGuidance(projectDir: string, now: () => number = Date.now): () => string | undefined {
  let cached: { at: number; text: string | undefined } | undefined
  return () => {
    if (!cached || now() - cached.at > CACHE_MS) cached = { at: now(), text: pausedWorkGuidance(listPaused(projectDir)) }
    return cached.text
  }
}
