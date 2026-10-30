/** Waits out a lost connection before the bench retries a run, so a network drop does not use up its retries. */
export type WaitOptions = {
  readonly reachable: () => Promise<boolean>
  readonly sleep: (ms: number) => Promise<void>
  readonly intervalMs: number
  readonly maxWaitMs: number
}

export type WaitResult = { readonly connected: boolean; readonly waitedMs: number }

export async function waitForConnection(options: WaitOptions): Promise<WaitResult> {
  let waitedMs = 0
  for (;;) {
    const up = await options.reachable().catch(() => false)
    if (up) return { connected: true, waitedMs }
    if (waitedMs >= options.maxWaitMs) return { connected: false, waitedMs }
    await options.sleep(options.intervalMs)
    waitedMs += options.intervalMs
  }
}

/** Any HTTP answer from the host means the connection works; only a transport error does not. */
export function hostAnswers(url: string): () => Promise<boolean> {
  return () => fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) }).then(() => true, () => false)
}
