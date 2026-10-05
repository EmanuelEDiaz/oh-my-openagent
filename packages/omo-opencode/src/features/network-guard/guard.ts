/**
 * Network guard (fork roadmap 0.15 A): a lost connection is waited out on the same session and model instead of
 * being treated as a model failure. OpenCode's own retry runs first (its attempt/next are only shown); the guard takes
 * over when OpenCode gives up (network session.error / assistant error) or a busy session goes silent. It probes the
 * provider and a neutral HTTPS site with backoff: both down → our network is down, wait; only the provider down →
 * after one more probe cycle hand off to the normal fallback path. When the network returns the session continues on
 * the same model; when the probe limit is spent the work is recorded for resumption, never moved to another model.
 * While a session is busy it also watches for network changes (Linux `ip monitor`, and an address fingerprint on every
 * platform): a stream that goes silent after a network change or a freeze is a cut, resumed on the same model.
 */
import { isNetworkError } from "@oh-my-opencode/model-core"

type GuardEvent = { type: string; properties?: unknown }

export type ProbeVerdict = "online" | "offline" | "provider-down"

export type NetworkGuardOptions = {
  readonly probeLimit: number
  /** Waits between probes in seconds; the last one repeats. Each gets ±25 % jitter. */
  readonly backoffS: readonly number[]
  readonly neutralProbeUrl: string
  /** A busy session with no stream data for this long is probed (a dead connection may hang without an error). */
  readonly silentStreamMs: number
  /** Interval of the silent-stream check; 0 disables the timer (tests call `tick`). */
  readonly checkIntervalMs: number
}

export type NetworkGuardDeps = {
  readonly now?: () => number
  readonly random?: () => number
  /** Schedules `fn` after `ms`; returns a cancel function. */
  readonly schedule?: (fn: () => void, ms: number) => () => void
  /** True when the URL answered with any HTTP response (a status code means the host is reachable). */
  readonly probe: (url: string) => Promise<boolean>
  readonly providerProbeUrl: (sessionID: string) => Promise<string | undefined>
  readonly toast: (message: string, variant: "info" | "success" | "warning" | "error") => Promise<void>
  /** Internal prompt on the same session and model (no model override). */
  readonly continueSession: (sessionID: string, text: string) => Promise<void>
  /** Stops a hung turn before it is continued (only used when OpenCode had not given up). */
  readonly abort: (sessionID: string) => Promise<void>
  /** The provider is down but our network is fine: the normal fallback path takes over. */
  readonly handOff: (sessionID: string, detail: string) => Promise<void>
  readonly recordInterruption: (sessionID: string, detail: string) => void
  /**
   * Reports network changes at once (Linux `ip monitor`); undefined when unavailable. Runs while a session is busy or
   * waits: it wakes the probes and marks the change for silent sessions.
   */
  readonly watchLink?: (onChange: () => void) => { stop(): void } | undefined
  /** Cheap fingerprint of the local addresses (os.networkInterfaces); compared on every check to see a change. */
  readonly networkFingerprint?: () => string
  /**
   * Charges the task's retry budget shared with the loop breaker (0.9b) when the provider keeps failing although the
   * network works; exhausted → the work is saved instead of switching models.
   */
  readonly chargeBudget?: (sessionID: string) => { used: number; max: number; exhausted: boolean } | undefined
  readonly log?: (message: string, data?: Record<string, unknown>) => void
  /** The `snapshot()` view changed (the sidebar mirror is rewritten). */
  readonly onChange?: () => void
}

type Phase = "online" | "retrying" | "offline"

/** Per-session view for logs and the sidebar; only sessions that wait on the network or a freeze. */
export type NetworkGuardSessionView = {
  readonly sessionID: string
  readonly phase: Phase
  /** Probes done in the current cycle (guard), or OpenCode's own attempt while it retries. */
  readonly attempt?: number
  readonly limit: number
  /** Verdict of the last probe of the current cycle. */
  readonly verdict?: ProbeVerdict
  /** When the next probe (or OpenCode's next retry) runs, epoch ms. */
  readonly nextAt?: number
  /** When the wait started, epoch ms. */
  readonly since?: number
  /** Busy while the process was frozen; the session is about to be resumed. */
  readonly frozenSeconds?: number
}

type Cycle = {
  gaveUp: boolean
  since: number
  /** Last network error of this cycle: user activity after it means the user took over. */
  anchor: number
  attempt: number
  cancelled: boolean
  retryAfterMs?: number
  verdict?: ProbeVerdict
  nextAt?: number
  /** Ends the current wait early. */
  wake?: () => void
}

type SessionState = {
  busy: boolean
  /** When the current turn started (idle → busy). */
  busyAt?: number
  lastData: number
  runningTools: Set<string>
  phase: Phase
  /** A probe cycle runs for this session. */
  cycle?: Cycle
  /** Probed once for this silence; cleared by the next stream data. */
  silentChecked: boolean
  /** Busy while the process was frozen or suspended; cleared by the next stream data or when the session ends. */
  frozenSeconds?: number
  /** OpenCode's own retry of a network error (phase "retrying"). */
  retry?: { attempt?: number; nextAt?: number; since: number }
  /** Same-model continuations sent with no model data since: the provider's transport fails while the network works. */
  resumesWithoutData: number
  /** Last event of the session, for pruning idle sessions. */
  touchedAt: number
  lastUserMessageID?: string
  lastUserAt?: number
  lastAbortAt?: number
  /** Assistant message whose network error was already handled (a later update of it is not a new cut). */
  lastErrorMessageID?: string
}

const LINK_WAKE_MIN_GAP_MS = 2_000
/** Continuations on the same model that may fail in a row before the provider is treated as down. */
const MAX_RESUMES_WITHOUT_DATA = 2
const IDLE_PRUNE_MS = 30 * 60_000

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function sessionIDOf(properties: unknown): string | undefined {
  const props = record(properties)
  const id = props?.sessionID ?? record(props?.part)?.sessionID ?? record(props?.info)?.sessionID
  return typeof id === "string" ? id : undefined
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  return `${minutes} min`
}

/** `retry-after` of an API error (seconds or HTTP date), in ms. */
export function retryAfterMs(error: unknown, now: number): number | undefined {
  const data = record(record(error)?.data) ?? record(error)
  const headers = record(data?.responseHeaders) ?? record(data?.headers)
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"]
  if (typeof raw !== "string" && typeof raw !== "number") return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(String(raw))
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

export const restoredText = (after: string): string =>
  `[network-guard] Connection restored after ${after}. Continue from the last completed step; check the effect of any tool call that was cut before repeating it.`

export const unfrozenText = (seconds: number): string =>
  `[network-guard] The process was frozen for ${seconds} s and the model connection was lost. Continue from the last completed step; check the effect of any tool call that was cut before repeating it.`

export const networkChangedText =
  "[network-guard] The network changed while the model was answering and the connection was lost. Continue from the last completed step; check the effect of any tool call that was cut before repeating it."

export function createNetworkGuard(options: NetworkGuardOptions, deps: NetworkGuardDeps) {
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random
  const log = deps.log ?? (() => undefined)
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms)
    timer.unref?.()
    return () => clearTimeout(timer)
  })
  const sessions = new Map<string, SessionState>()
  const wakers = new Set<() => void>()
  let link: { stop(): void } | undefined
  let lastProbeAt = 0
  let lastView = "[]"
  let fingerprint: string | undefined
  /** Last network change seen (link monitor or address fingerprint), epoch ms. */
  let networkChangedAt: number | undefined

  /** Tells the listener when the sidebar view changed; cheap when nothing waits (the view is "[]"). */
  function changed(): void {
    if (!deps.onChange) return
    const view = JSON.stringify(guard.snapshot())
    if (view === lastView) return
    lastView = view
    deps.onChange()
  }

  function state(sessionID: string): SessionState {
    let current = sessions.get(sessionID)
    if (!current) {
      current = { busy: false, lastData: now(), runningTools: new Set(), phase: "online", silentChecked: false, resumesWithoutData: 0, touchedAt: now() }
      sessions.set(sessionID, current)
    }
    return current
  }

  function backoffMs(attempt: number): number {
    const steps = options.backoffS
    const base = (steps[Math.min(attempt - 1, steps.length - 1)] ?? 60) * 1000
    return Math.round(base * (1 + (random() * 2 - 1) * 0.25))
  }

  /** Sleeps `ms`, or less when the network changes (Linux link monitor) or the cycle is cancelled. */
  function wait(ms: number, cycle: Cycle): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        cancel()
        wakers.delete(wake)
        resolve()
      }
      const wake = (): void => finish()
      const cancel = schedule(finish, ms)
      wakers.add(wake)
      cycle.wake = wake
    })
  }

  function noteNetworkChange(): void {
    networkChangedAt = now()
    // A silent session already probed gets one more check: the change may have killed its stream.
    for (const current of sessions.values()) if (current.busy) current.silentChecked = false
    log("[network-guard] network changed")
  }

  /** Compares the address fingerprint with the last one; a difference is a network change. */
  function checkFingerprint(): void {
    if (!deps.networkFingerprint) return
    let next: string
    try {
      next = deps.networkFingerprint()
    } catch (error) {
      log("[network-guard] network fingerprint failed", { error: String(error) })
      return
    }
    if (fingerprint !== undefined && next !== fingerprint) noteNetworkChange()
    fingerprint = next
  }

  function onLinkChange(): void {
    // With a fingerprint, only a real address change counts (route and lifetime updates are frequent noise).
    if (deps.networkFingerprint) checkFingerprint()
    else noteNetworkChange()
    if (now() - lastProbeAt < LINK_WAKE_MIN_GAP_MS) return
    log("[network-guard] network change; probing now")
    for (const wake of [...wakers]) wake()
  }

  function cancelCycle(cycle: Cycle | undefined): void {
    if (!cycle) return
    cycle.cancelled = true
    cycle.wake?.()
  }

  /** The link monitor runs while a session waits on the network or is busy (a change may kill its stream). */
  function updateLinkWatch(): void {
    const waiting = [...sessions.values()].some((current) => current.busy || (current.cycle && !current.cycle.cancelled))
    if (waiting && !link) link = deps.watchLink?.(onLinkChange)
    if (!waiting && link) {
      link.stop()
      link = undefined
    }
  }

  async function probeOnce(sessionID: string): Promise<ProbeVerdict> {
    lastProbeAt = now()
    const providerUrl = await deps.providerProbeUrl(sessionID).catch(() => undefined)
    const [neutralOk, providerOk] = await Promise.all([
      deps.probe(options.neutralProbeUrl).catch(() => false),
      providerUrl ? deps.probe(providerUrl).catch(() => false) : Promise.resolve(undefined),
    ])
    if (!neutralOk && providerOk !== true) return "offline"
    return providerOk === false ? "provider-down" : "online"
  }

  function stillHung(current: SessionState, since: number): boolean {
    return current.busy && current.lastData <= since
  }

  /** The user wrote or pressed Esc after the cycle's last network error: the session is theirs again. */
  function userTookOver(current: SessionState, cycle: Cycle): boolean {
    if ((current.lastUserAt ?? -Infinity) > cycle.anchor || (current.lastAbortAt ?? -Infinity) > cycle.anchor) return true
    // OpenCode had ended the turn: a turn started after the error is one the user started.
    return cycle.gaveUp && current.busy && (current.busyAt ?? -Infinity) > cycle.anchor
  }

  /** Why a silent stream was cut although the network works: a freeze, or a network change during the silence. */
  function cutText(current: SessionState): string | undefined {
    if (current.frozenSeconds !== undefined) return unfrozenText(current.frozenSeconds)
    if (networkChangedAt !== undefined && networkChangedAt > current.lastData) return networkChangedText
    return undefined
  }

  async function handOff(sessionID: string, current: SessionState, gaveUp: boolean, since: number, detail: string, charge: boolean): Promise<void> {
    current.resumesWithoutData = 0
    if (!gaveUp && stillHung(current, since)) await deps.abort(sessionID).catch(() => undefined)
    const budget = charge ? deps.chargeBudget?.(sessionID) : undefined
    if (budget?.exhausted) {
      log("[network-guard] the task's retry budget is spent; work saved for resumption", { sessionID, used: budget.used, max: budget.max })
      deps.recordInterruption(sessionID, `${detail}; retry budget spent (${budget.used}/${budget.max})`)
      await deps.toast("El proveedor sigue fallando y el presupuesto de reintentos está agotado. El trabajo está guardado; escribe cualquier mensaje para continuar.", "error")
      return
    }
    await deps.handOff(sessionID, detail)
  }

  /**
   * Continues on the same model, unless the last continuations all failed before any model data: then the provider's
   * transport is what fails (the neutral site may answer while the provider refuses), so the fallback path takes over.
   */
  async function resumeSameModel(sessionID: string, current: SessionState, gaveUp: boolean, since: number, text: string): Promise<void> {
    if (!gaveUp && !stillHung(current, since)) return
    if (current.resumesWithoutData >= MAX_RESUMES_WITHOUT_DATA) {
      log("[network-guard] the provider keeps failing although the network works; handing off to the fallback path", { sessionID, resumes: current.resumesWithoutData })
      await handOff(sessionID, current, gaveUp, since, `provider failed ${current.resumesWithoutData + 1} times in a row while the network works`, true)
      return
    }
    if (!gaveUp) {
      // OpenCode never errored: the turn is still hung on a dead socket. Stop it.
      await deps.abort(sessionID).catch((error) => log("[network-guard] abort failed", { sessionID, error: String(error) }))
    }
    current.resumesWithoutData += 1
    await deps.continueSession(sessionID, text)
  }

  async function runCycle(sessionID: string, gaveUp: boolean, firstVerdict?: ProbeVerdict): Promise<void> {
    const current = state(sessionID)
    if (current.cycle && !current.cycle.cancelled) {
      current.cycle.gaveUp ||= gaveUp
      return
    }
    const cycle: Cycle = { gaveUp, since: now(), anchor: now(), attempt: 0, cancelled: false }
    current.cycle = cycle
    current.phase = "offline"
    current.retry = undefined
    updateLinkWatch()
    changed()
    let providerDownSeen = false
    try {
      while (!cycle.cancelled) {
        cycle.attempt += 1
        const verdict = cycle.attempt === 1 && firstVerdict ? firstVerdict : await probeOnce(sessionID)
        if (cycle.cancelled) return
        cycle.verdict = verdict
        changed()
        if ((verdict === "online" || (verdict === "provider-down" && providerDownSeen)) && userTookOver(current, cycle)) {
          log("[network-guard] the user took the session over; no continuation", { sessionID })
          current.phase = "online"
          cycle.cancelled = true
          return
        }
        if (verdict === "online") {
          const after = formatDuration(now() - cycle.since)
          log("[network-guard] connection restored", { sessionID, after, gaveUp: cycle.gaveUp })
          current.phase = "online"
          cycle.cancelled = true
          await deps.toast(`Conexión recuperada tras ${after}; continuando en la misma sesión.`, "success")
          await resumeSameModel(sessionID, current, cycle.gaveUp, cycle.since, restoredText(after))
          return
        }
        if (verdict === "provider-down") {
          if (providerDownSeen) {
            log("[network-guard] provider unreachable, our network is fine; handing off to the fallback path", { sessionID })
            current.phase = "online"
            cycle.cancelled = true
            await handOff(sessionID, current, cycle.gaveUp, cycle.since, "provider unreachable while the network works", false)
            return
          }
          providerDownSeen = true
        } else {
          providerDownSeen = false
        }
        if (cycle.attempt >= options.probeLimit) break
        const delay = Math.max(backoffMs(cycle.attempt), cycle.retryAfterMs ?? 0)
        cycle.retryAfterMs = undefined
        const what = verdict === "provider-down" ? "Proveedor sin respuesta" : "Sin conexión"
        cycle.nextAt = now() + delay
        changed()
        await deps.toast(`${what} · reintento ${cycle.attempt + 1}/${options.probeLimit} en ${Math.round(delay / 1000)} s`, "warning")
        await wait(delay, cycle)
        cycle.nextAt = undefined
      }
      if (cycle.cancelled) return
      const detail = `no connection for ${formatDuration(now() - cycle.since)} (${options.probeLimit} probes)`
      log("[network-guard] probe limit spent; work saved for resumption", { sessionID, detail })
      current.phase = "online"
      cycle.cancelled = true
      if (!cycle.gaveUp && stillHung(current, cycle.since)) await deps.abort(sessionID).catch(() => undefined)
      deps.recordInterruption(sessionID, detail)
      await deps.toast(`Sin conexión durante ${formatDuration(now() - cycle.since)}. El trabajo está guardado: cuando vuelva la red, escribe cualquier mensaje para continuar.`, "error")
    } finally {
      if (current.cycle === cycle) current.cycle = undefined
      updateLinkWatch()
      changed()
    }
  }

  function startCycle(sessionID: string, gaveUp: boolean, firstVerdict?: ProbeVerdict): void {
    void runCycle(sessionID, gaveUp, firstVerdict).catch((error) =>
      log("[network-guard] probe cycle failed", { sessionID, error: String(error) }))
  }

  /**
   * Network up but the stream silent since a freeze or a network change: its socket died with the old link. Resumed
   * on the same model. False when there is no such cause (a model matter).
   */
  async function resumeCut(sessionID: string, current: SessionState, stopped: boolean, since: number): Promise<boolean> {
    const text = cutText(current)
    if (!text) return false
    log("[network-guard] silent after a freeze or a network change; resuming on the same model", { sessionID, frozenSeconds: current.frozenSeconds })
    current.frozenSeconds = undefined
    changed()
    if (text === networkChangedText && (stopped || stillHung(current, since))) {
      await deps.toast("La red cambió durante la respuesta; continuando en la misma sesión.", "info")
    }
    await resumeSameModel(sessionID, current, stopped, since, text)
    return true
  }

  /**
   * One probe for a silent or freeze-suspect session: offline starts a cycle; with `resume`, a session that stayed
   * silent since a freeze or a network change is resumed on the same model.
   */
  async function checkSilent(sessionID: string, resume: boolean): Promise<void> {
    const current = state(sessionID)
    if (current.cycle) return
    // The freeze probe must not use up the silent-stream check that may resume the session later.
    if (resume) current.silentChecked = true
    const since = now()
    const verdict = await probeOnce(sessionID)
    if (verdict === "offline") {
      log("[network-guard] silent session and no network; treating it as a cut", { sessionID })
      startCycle(sessionID, false, verdict)
      return
    }
    if (resume && verdict === "online" && stillHung(current, since)) await resumeCut(sessionID, current, false, since)
  }

  /**
   * Stream data arrived. `fromModel`: it can only come from the model (a delta, a tool or reasoning part), so the
   * connection works again; a plain text part may be the user's own message and only ends a silent-stream cycle.
   */
  function markData(current: SessionState, fromModel: boolean): void {
    current.lastData = now()
    current.silentChecked = false
    current.frozenSeconds = undefined
    if (fromModel) current.resumesWithoutData = 0
    leaveRetrying(current)
    if (current.cycle && !current.cycle.cancelled && (fromModel || !current.cycle.gaveUp)) {
      cancelCycle(current.cycle)
      current.phase = "online"
    }
  }

  function leaveRetrying(current: SessionState): void {
    if (current.phase === "retrying") current.phase = "online"
    current.retry = undefined
  }

  /**
   * OpenCode's retry is a wait only until its next attempt plus the silent-stream window: an attempt that hangs
   * without a status change must not exempt the session from every check.
   */
  function retryActive(current: SessionState): boolean {
    if (current.phase !== "retrying") return false
    const from = current.retry?.nextAt ?? current.retry?.since ?? current.lastData
    return now() <= from + options.silentStreamMs
  }

  /** The session stopped running (idle, error, deleted turn): its freeze mark is stale. */
  function endTurn(current: SessionState): void {
    current.busy = false
    current.runningTools.clear()
    current.frozenSeconds = undefined
    leaveRetrying(current)
  }

  function onRetryStatus(sessionID: string, status: Record<string, unknown>): void {
    const message = typeof status.message === "string" ? status.message : ""
    const current = state(sessionID)
    if (!isNetworkError(message)) {
      // A 429/5xx retry is the fallback path's business; a former network retry is over.
      leaveRetrying(current)
      return
    }
    current.phase = current.cycle ? current.phase : "retrying"
    const attempt = typeof status.attempt === "number" ? status.attempt : undefined
    const next = typeof status.next === "number" ? Math.max(0, Math.round((status.next - now()) / 1000)) : undefined
    current.retry = {
      ...(attempt !== undefined ? { attempt } : {}),
      ...(typeof status.next === "number" ? { nextAt: status.next } : {}),
      since: current.retry?.since ?? now(),
    }
    log("[network-guard] OpenCode is retrying a network error", { sessionID, attempt, next, message })
    void deps.toast(`Sin conexión · OpenCode reintenta${attempt ? ` (intento ${attempt})` : ""}${next !== undefined ? ` en ${next} s` : ""}`, "warning")
  }

  function handleEvent(event: GuardEvent): void {
    const sessionID = sessionIDOf(event.properties)
    if (!sessionID) return
    if (event.type === "session.deleted") {
      cancelCycle(sessions.get(sessionID)?.cycle)
      sessions.delete(sessionID)
      updateLinkWatch()
      return
    }
    const current = state(sessionID)
    current.touchedAt = now()
    const props = record(event.properties)
    if (event.type === "session.status") {
      const status = record(props?.status)
      if (status?.type === "idle") {
        endTurn(current)
      } else if (status?.type === "retry") {
        current.busy = true
        onRetryStatus(sessionID, status)
      } else if (status?.type === "busy" && (!current.busy || current.phase === "retrying")) {
        // A new turn, or OpenCode's next attempt after its retry backoff (it sets busy before each attempt).
        if (!current.busy) {
          current.frozenSeconds = undefined
          current.busyAt = now()
        }
        current.busy = true
        current.lastData = now()
        current.silentChecked = false
        leaveRetrying(current)
      }
      updateLinkWatch()
      return
    }
    if (event.type === "session.idle") {
      endTurn(current)
      updateLinkWatch()
      return
    }
    if (event.type === "session.error") {
      endTurn(current)
      const error = record(props?.error)
      if (typeof error?.name === "string" && /abort/i.test(error.name)) current.lastAbortAt = now()
      else guard.notifyNetworkError(sessionID, props?.error, { gaveUp: true })
      updateLinkWatch()
      return
    }
    if (event.type === "message.updated") {
      const info = record(props?.info)
      const messageID = typeof info?.id === "string" ? info.id : undefined
      if (info?.role === "user" && messageID && messageID !== current.lastUserMessageID) {
        current.lastUserMessageID = messageID
        current.lastUserAt = now()
      }
      if (info?.role === "assistant" && info.error) {
        // A later update of an errored message already handled is not a new cut.
        if (messageID && messageID === current.lastErrorMessageID) return
        if (guard.notifyNetworkError(sessionID, info.error, { gaveUp: true }) && messageID) current.lastErrorMessageID = messageID
      }
      return
    }
    if (event.type === "message.part.updated") {
      const part = record(props?.part)
      if (part?.type === "tool") {
        const callID = typeof part.callID === "string" ? part.callID : String(part.id ?? "")
        const status = record(part.state)?.status
        if (status === "running" || status === "pending") current.runningTools.add(callID)
        else current.runningTools.delete(callID)
      }
      markData(current, part?.type !== "text" && part?.type !== "file")
      return
    }
    if (event.type === "message.part.delta") markData(current, true)
  }

  checkFingerprint()
  const timer = options.checkIntervalMs > 0 ? setInterval(() => void guard.tick(), options.checkIntervalMs) : undefined
  timer?.unref?.()

  const guard = {
    event(input: { event: GuardEvent }): void {
      handleEvent(input.event)
      changed()
    },

    /**
     * A fallback path met a network error and stepped aside. `gaveUp`: OpenCode's own retry is over (session.error,
     * assistant error), so the guard probes and continues the session itself; otherwise OpenCode is still retrying.
     */
    notifyNetworkError(sessionID: string, error: unknown, opts: { gaveUp: boolean }): boolean {
      if (!isNetworkError(error)) return false
      const current = state(sessionID)
      if (!opts.gaveUp) {
        if (!current.cycle) current.phase = "retrying"
        changed()
        return true
      }
      const retryAfter = retryAfterMs(error, now())
      if (current.cycle && !current.cycle.cancelled) {
        current.cycle.gaveUp = true
        current.cycle.anchor = now()
        if (retryAfter !== undefined) current.cycle.retryAfterMs = retryAfter
        return true
      }
      log("[network-guard] OpenCode gave up on a network error; probing", { sessionID })
      startCycle(sessionID, true)
      const cycle = sessions.get(sessionID)?.cycle
      if (cycle && retryAfter !== undefined) cycle.retryAfterMs = retryAfter
      return true
    },

    /**
     * The session waits on the network (guard probing, or OpenCode retrying a network error until its next attempt
     * plus the silent-stream window): not stalled.
     */
    isWaiting(sessionID: string): boolean {
      const current = sessions.get(sessionID)
      if (!current) return false
      return current.phase === "offline" || (current.cycle !== undefined && !current.cycle.cancelled) || retryActive(current)
    },

    /**
     * Called by the stall watchdog before it recovers a stall: true when the cause is the network, a network change or
     * a freeze and the guard took over (same model, no budget charge); false when it is a real model stall.
     */
    async takeOverStall(sessionID: string, opts: { stopped: boolean }): Promise<boolean> {
      const current = state(sessionID)
      if (guard.isWaiting(sessionID)) return true
      checkFingerprint()
      const since = now()
      const verdict = await probeOnce(sessionID)
      if (verdict === "offline") {
        log("[network-guard] stall caused by the network; waiting instead of switching models", { sessionID })
        startCycle(sessionID, opts.stopped, verdict)
        return true
      }
      if (verdict === "online") return resumeCut(sessionID, current, opts.stopped, since)
      return false
    },

    /**
     * The process was frozen or suspended: sockets of busy sessions may be dead. Probe now (offline → cut); a session
     * that then stays silent for `silentStreamMs` is resumed on the same model by the silent-stream check.
     */
    afterFreeze(sessionIDs: readonly string[], seconds: number): void {
      for (const sessionID of sessionIDs) {
        const current = sessions.get(sessionID)
        if (!current?.busy) continue
        current.frozenSeconds = seconds
        current.lastData = now()
        if (!current.cycle) {
          void checkSilent(sessionID, false).catch((error) => log("[network-guard] freeze probe failed", { sessionID, error: String(error) }))
        }
      }
      changed()
    },

    /**
     * Silent-stream check: busy sessions with no data (and no running tool) for `silentStreamMs` are probed once (again
     * after a network change). Also compares the address fingerprint and drops sessions idle for a long time.
     */
    async tick(): Promise<void> {
      checkFingerprint()
      const checks: Promise<void>[] = []
      for (const [sessionID, current] of sessions) {
        if (!current.busy && !current.cycle && current.phase === "online" && now() - current.touchedAt > IDLE_PRUNE_MS) {
          sessions.delete(sessionID)
          continue
        }
        if (current.phase === "retrying") {
          if (retryActive(current)) continue
          // OpenCode's next attempt never reported back: from now on its silence counts.
          current.lastData = Math.max(current.lastData, current.retry?.nextAt ?? current.retry?.since ?? current.lastData)
          leaveRetrying(current)
          changed()
        }
        if (!current.busy || current.cycle || current.silentChecked) continue
        if (current.runningTools.size > 0) continue
        if (now() - current.lastData < options.silentStreamMs) continue
        checks.push(checkSilent(sessionID, true).catch((error) => log("[network-guard] silent probe failed", { sessionID, error: String(error) })))
      }
      await Promise.all(checks)
    },

    /** Per-session view for logs and the sidebar. */
    snapshot(): NetworkGuardSessionView[] {
      const views: NetworkGuardSessionView[] = []
      for (const [sessionID, current] of sessions) {
        const frozen = current.busy && current.frozenSeconds !== undefined
        const cycle = current.cycle && !current.cycle.cancelled ? current.cycle : undefined
        const phase: Phase = current.phase === "retrying" && !retryActive(current) ? "online" : current.phase
        if (phase === "online" && !frozen) continue
        const retry = !cycle && phase === "retrying" ? current.retry : undefined
        views.push({
          sessionID,
          phase,
          ...(cycle ? { attempt: cycle.attempt, since: cycle.since } : {}),
          ...(cycle?.verdict ? { verdict: cycle.verdict } : {}),
          ...(cycle?.nextAt !== undefined ? { nextAt: cycle.nextAt } : {}),
          ...(retry?.attempt !== undefined ? { attempt: retry.attempt } : {}),
          ...(retry?.nextAt !== undefined ? { nextAt: retry.nextAt } : {}),
          ...(retry ? { since: retry.since } : {}),
          limit: options.probeLimit,
          ...(frozen ? { frozenSeconds: current.frozenSeconds } : {}),
        })
      }
      return views
    },

    /** Sessions tracked (diagnostics; idle ones are pruned). */
    trackedSessions(): number {
      return sessions.size
    },

    dispose(): void {
      if (timer) clearInterval(timer)
      for (const current of sessions.values()) cancelCycle(current.cycle)
      link?.stop()
      link = undefined
    },
  }
  return guard
}

export type NetworkGuard = ReturnType<typeof createNetworkGuard>
