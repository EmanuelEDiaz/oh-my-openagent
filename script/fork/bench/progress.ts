/**
 * Free models sometimes stall mid-stream: the request stays open with no output and no error, and OpenCode never
 * cuts it. A run whose session changes nothing for the stall window is aborted as infrastructure and retried.
 */

type ProgressMessage = { info: { role?: string }; parts: { type?: string; state?: { status?: string } }[] }

/** Changes whenever a message, a part or a tool status is added or updated. */
export function progressSignature(messages: readonly ProgressMessage[]): string {
  return messages.map((message) => `${message.info.role}:${message.parts.map((part) => `${part.type}/${part.state?.status ?? ""}`).join(",")}`).join("|")
}

export function createStallDetector(stallMs: number, now: () => number = Date.now) {
  let lastSignature: string | undefined
  let lastChange = now()
  return {
    /** Records the current signature and says whether nothing changed for longer than the window. */
    stalled(signature: string): boolean {
      if (signature !== lastSignature) {
        lastSignature = signature
        lastChange = now()
        return false
      }
      return now() - lastChange > stallMs
    },
  }
}
