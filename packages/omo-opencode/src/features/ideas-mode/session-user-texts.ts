import type { PluginInput } from "@opencode-ai/plugin"

import { log } from "../../shared/logger"

type MessageLike = {
  readonly info?: { readonly role?: string; readonly time?: { readonly created?: number } }
  readonly parts?: ReadonlyArray<{ readonly type?: string; readonly text?: string; readonly synthetic?: boolean }>
}

/**
 * What the user typed, one string per user message, oldest first. Synthetic parts (notes the plugin or OpenCode add
 * to a user message) are left out, so no injected text can switch ideas mode or count as the user's order.
 */
export function userTextsFromMessages(messages: readonly MessageLike[]): string[] {
  return [...messages]
    .filter((message) => message.info?.role === "user")
    .sort((left, right) => (left.info?.time?.created ?? 0) - (right.info?.time?.created ?? 0))
    .map((message) => (message.parts ?? []).filter((part) => part.type === "text" && !part.synthetic && typeof part.text === "string").map((part) => part.text).join("\n"))
    .filter((text) => text.trim() !== "")
}

/** Undefined when the messages cannot be read (the caller then lets the planner work as before). */
export async function readSessionUserTexts(client: PluginInput["client"], sessionID: string): Promise<string[] | undefined> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const data = (response as { data?: unknown }).data ?? response
    return Array.isArray(data) ? userTextsFromMessages(data as MessageLike[]) : undefined
  } catch (error) {
    log("[ideas-mode] cannot read the session's messages", { sessionID, error: String(error) })
    return undefined
  }
}
