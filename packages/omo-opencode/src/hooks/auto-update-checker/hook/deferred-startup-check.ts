/** Runs the startup check 5 s after the first root session; the returned function cancels it (fork incident H53). */
export function scheduleDeferredStartupCheck(runCheck: () => void): () => void {
  const timeout = setTimeout(runCheck, 5000)
  timeout.unref?.()
  return () => clearTimeout(timeout)
}
