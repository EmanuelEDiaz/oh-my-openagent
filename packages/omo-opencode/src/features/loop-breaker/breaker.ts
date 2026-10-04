/**
 * Loop breaker (fork roadmap 0.9b). Debugging effectiveness drops 60–80 % after 2–3 failed attempts and a fresh start
 * recovers part of it (arXiv 2506.18403), so the same error after repeated fixes escalates instead of looping:
 * 2 failed fixes → nudge to change hypothesis; 3 → web research + a fresh debugger before more edits; 4, or a fix almost
 * identical to an earlier one → edits to those files blocked until the user chooses. Every escalation spends the task's
 * retry budget (shared with stall recovery); when it runs out the work is paused, never retried forever.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "../../shared/write-file-atomically"
import { fingerprintError, similarity, type ErrorFingerprint } from "./fingerprint"

export type Edit = { readonly file: string; readonly text: string }
type Attempt = { readonly edits: readonly Edit[]; readonly at: string }
type ErrorState = { summary: string; sightings: number; attempts: Attempt[]; countFrom: number; level: 0 | 2 | 3 | 4 }

export type LoopState = {
  errors: Record<string, ErrorState>
  current?: string
  pendingEdits: Edit[]
  blocked?: { readonly key: string; readonly files: readonly string[]; readonly level: 3 | 4; researched: boolean; debugged: boolean }
  budget: { used: number; history: Array<{ cause: string; at: string }> }
}

export type Escalation = {
  readonly level: 2 | 3 | 4
  readonly key: string
  readonly summary: string
  readonly files: readonly string[]
  readonly attempts: number
  readonly repeatedFix: boolean
  readonly budget: { readonly used: number; readonly max: number; readonly exhausted: boolean }
}

export type BreakerOptions = {
  readonly projectDir: string
  readonly maxPerTask: number
  readonly thresholds: { readonly nudge: number; readonly research: number; readonly block: number }
  readonly now?: () => Date
}

const SIMILAR_FIX = 0.9

function emptyState(): LoopState {
  return { errors: {}, pendingEdits: [], budget: { used: 0, history: [] } }
}

export function runIdFor(rootSessionID: string): string {
  return `run_${rootSessionID.replace(/[^\w-]/g, "_")}`
}

export function createLoopBreaker(options: BreakerOptions) {
  const cache = new Map<string, LoopState>()
  const now = () => (options.now?.() ?? new Date()).toISOString()

  function file(root: string): string {
    return join(options.projectDir, ".omo", "runs", runIdFor(root), "loops.json")
  }

  function load(root: string): LoopState {
    const cached = cache.get(root)
    if (cached) return cached
    let state = emptyState()
    try {
      const path = file(root)
      if (existsSync(path)) state = { ...emptyState(), ...(JSON.parse(readFileSync(path, "utf8")) as LoopState) }
    } catch {
      // a corrupt file starts over; the history is a help, not a requirement
    }
    cache.set(root, state)
    return state
  }

  function save(root: string, state: LoopState): void {
    try {
      const path = file(root)
      mkdirSync(join(path, ".."), { recursive: true })
      const runs = join(options.projectDir, ".omo", "runs")
      if (!existsSync(join(runs, ".gitignore"))) writeFileAtomically(join(runs, ".gitignore"), "*\n")
      writeFileAtomically(path, JSON.stringify(state, null, 2))
    } catch {
      // kept in memory for this process
    }
  }

  function budgetOf(state: LoopState) {
    return { used: state.budget.used, max: options.maxPerTask, exhausted: state.budget.used >= options.maxPerTask }
  }

  function charge(root: string, cause: string): { used: number; max: number; exhausted: boolean } {
    const state = load(root)
    state.budget.used++
    state.budget.history.push({ cause, at: now() })
    save(root, state)
    return budgetOf(state)
  }

  function sighting(root: string, fingerprint: ErrorFingerprint): Escalation | undefined {
    const state = load(root)
    const entry = (state.errors[fingerprint.key] ??= { summary: fingerprint.summary, sightings: 0, attempts: [], countFrom: 0, level: 0 })
    entry.sightings++
    let escalation: Escalation | undefined
    if (state.current === fingerprint.key && state.pendingEdits.length > 0) {
      const attempt: Attempt = { edits: state.pendingEdits, at: now() }
      const text = attempt.edits.map((edit) => `${edit.file}\n${edit.text}`).join("\n")
      const repeatedFix = entry.attempts.some((previous) => similarity(previous.edits.map((edit) => `${edit.file}\n${edit.text}`).join("\n"), text) >= SIMILAR_FIX)
      entry.attempts.push(attempt)
      const counted = entry.attempts.length - entry.countFrom
      const level = repeatedFix || counted >= options.thresholds.block ? 4 : counted >= options.thresholds.research ? 3 : counted >= options.thresholds.nudge ? 2 : 0
      if (level > entry.level) {
        entry.level = level as ErrorState["level"]
        const files = [...new Set(entry.attempts.flatMap((a) => a.edits.map((edit) => edit.file)))]
        state.budget.used++
        state.budget.history.push({ cause: `loop level ${level}: ${fingerprint.summary.slice(0, 80)}`, at: now() })
        if (level >= 3) state.blocked = { key: fingerprint.key, files, level: level as 3 | 4, researched: false, debugged: false }
        escalation = { level: level as 2 | 3 | 4, key: fingerprint.key, summary: entry.summary, files, attempts: counted, repeatedFix, budget: budgetOf(state) }
      }
    }
    state.current = fingerprint.key
    state.pendingEdits = []
    save(root, state)
    return escalation
  }

  return {
    /** A failing command or tool call; returns an escalation when this error keeps coming back after fixes. */
    observeError(root: string, output: string): Escalation | undefined {
      const fingerprint = fingerprintError(output)
      return fingerprint ? sighting(root, fingerprint) : undefined
    },

    observeFingerprint(root: string, fingerprint: ErrorFingerprint): Escalation | undefined {
      return sighting(root, fingerprint)
    },

    /** A successful run of the command that was failing clears the current error. */
    observeSuccess(root: string): void {
      const state = load(root)
      if (state.current) {
        const entry = state.errors[state.current]
        if (entry) {
          entry.level = 0
          entry.countFrom = entry.attempts.length
        }
        if (state.blocked?.key === state.current) state.blocked = undefined
        state.current = undefined
      }
      state.pendingEdits = []
      save(root, state)
    },

    recordEdit(root: string, edits: readonly Edit[]): void {
      if (edits.length === 0) return
      const state = load(root)
      state.pendingEdits.push(...edits.map((edit) => ({ file: edit.file, text: edit.text.slice(0, 4000) })))
      save(root, state)
    },

    /** Files whose edits are refused right now, and why. */
    blockedFor(root: string): LoopState["blocked"] {
      return load(root).blocked
    },

    onResearch(root: string): void {
      const state = load(root)
      if (state.blocked) state.blocked.researched = true
      save(root, state)
    },

    /** A fresh debugger looked at the error: level-3 blocks lift (level 4 waits for the user). */
    onDebugger(root: string): void {
      const state = load(root)
      if (state.blocked) {
        state.blocked.debugged = true
        if (state.blocked.level === 3) state.blocked = undefined
      }
      save(root, state)
    },

    /** The user answered or wrote: the block lifts, and their choice is what happens next. */
    onUserDecision(root: string): void {
      const state = load(root)
      if (state.blocked) {
        const entry = state.errors[state.blocked.key]
        if (entry) entry.countFrom = entry.attempts.length
        if (entry) entry.level = 0
        state.blocked = undefined
      }
      save(root, state)
    },

    /** A new user request (or "reanuda"): fresh budget; the attempt history is kept so old fixes are not repeated. */
    newRequest(root: string): void {
      const state = load(root)
      state.budget.used = 0
      state.budget.history.push({ cause: "new user request: budget reset", at: now() })
      for (const entry of Object.values(state.errors)) {
        entry.countFrom = entry.attempts.length
        entry.level = 0
      }
      state.blocked = undefined
      state.current = undefined
      state.pendingEdits = []
      save(root, state)
    },

    charge,
    budget(root: string) {
      return budgetOf(load(root))
    },

    /** Previous attempts on an error, for the nudge and the research/debugger brief. */
    attemptsSummary(root: string, key: string): string[] {
      const entry = load(root).errors[key]
      if (!entry) return []
      return entry.attempts.slice(-4).map((attempt, index) => `attempt ${index + 1}: ${attempt.edits.map((edit) => `${edit.file} (${edit.text.split("\n")[0]?.slice(0, 80) ?? ""})`).join("; ")}`)
    },
  }
}

export type LoopBreaker = ReturnType<typeof createLoopBreaker>
