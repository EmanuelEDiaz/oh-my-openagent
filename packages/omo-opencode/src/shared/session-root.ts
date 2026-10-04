/** The top-level session of a session tree, so a task's subagents share its state (fork roadmap 0.9a/0.9b). */
import type { PluginInput } from "@opencode-ai/plugin"

const MAX_DEPTH = 8

export function createSessionRootResolver(ctx: Pick<PluginInput, "client" | "directory">) {
  const roots = new Map<string, string>()
  return {
    async rootOf(sessionID: string): Promise<string> {
      const cached = roots.get(sessionID)
      if (cached) return cached
      let current = sessionID
      for (let depth = 0; depth < MAX_DEPTH; depth++) {
        const parent = await ctx.client.session
          .get({ path: { id: current }, query: { directory: ctx.directory } })
          .then((response) => (response as { data?: { parentID?: string } }).data?.parentID)
          .catch(() => undefined)
        if (!parent) break
        current = parent
      }
      roots.set(sessionID, current)
      return current
    },
    forget(sessionID: string): void {
      roots.delete(sessionID)
    },
  }
}
