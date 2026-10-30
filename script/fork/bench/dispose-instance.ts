/**
 * Disposes the OpenCode instance of a finished task's folder (fork incidents H4). OpenCode keeps one instance per
 * project folder until told otherwise, and each runs its own plugin instance plus an LSP proxy (~60 MB) and language
 * server: 19 task folders took the bench server to 1.6 GB and the memory cap stopped it (19-10-2026).
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

const DISPOSE_TIMEOUT_MS = 10_000

export async function disposeWorkdirInstance(baseUrl: string, directory: string): Promise<boolean> {
  try {
    const client = createOpencodeClient({ baseUrl, directory })
    const response = await Promise.race([
      client.instance.dispose({ directory }),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), DISPOSE_TIMEOUT_MS)),
    ])
    return response !== undefined && !("error" in response && response.error !== undefined)
  } catch {
    return false
  }
}
