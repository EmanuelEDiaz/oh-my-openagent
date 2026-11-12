/**
 * Nudges a tab agent that ended its turn announcing a next step it never took, with no todos for the enforcer to
 * use (fork incident H58; user decision 12-11-2026, "empujón con límites"). At most one nudge without progress in
 * between and three per session; never after /stop-continuation; switch: `announce-continuation` in disabled_hooks.
 */
import type { PluginInput } from "@opencode-ai/plugin"

import { isTabAgent } from "../../agents/tab-agent-roles"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { createInternalAgentContinuationTextPart } from "../../shared"
import { log } from "../../shared/logger"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"
import { announcedNextStep } from "./announce-detection"
import { CONTINUATION_COOLDOWN_MS, HOOK_NAME } from "./constants"
import type { SessionState } from "./types"

const MAX_NUDGES_WITHOUT_PROGRESS = 1
const MAX_NUDGES_PER_SESSION = 3
const NUDGE_PROMPT = "You ended your last turn announcing your next step without taking it. Do it now: continue the task from where you left off. If you are actually finished or need the user, say so explicitly."

type MessageLike = { info?: { role?: string; agent?: string }; parts?: { type?: string; text?: string }[] }

function usedToolSince(messages: readonly MessageLike[], from: number): boolean {
  return messages.slice(from).some((message) => message.info?.role === "assistant" && (message.parts ?? []).some((part) => part.type === "tool"))
}

export async function maybeNudgeAnnouncedStep(args: {
  ctx: PluginInput
  sessionID: string
  messages: readonly MessageLike[]
  state: SessionState
  isContinuationStopped?: (sessionID: string) => boolean
}): Promise<void> {
  const { ctx, sessionID, messages, state } = args
  if (state.announceNudgeAtLength !== undefined && usedToolSince(messages, state.announceNudgeAtLength)) state.announceNudgeConsecutive = 0
  if (!announcedNextStep(messages)) return
  const agent = messages.at(-1)?.info?.agent ?? getSessionAgent(sessionID)
  if (!isTabAgent(agent)) return
  if (args.isContinuationStopped?.(sessionID) || state.inFlight) return
  if ((state.announceNudgeConsecutive ?? 0) >= MAX_NUDGES_WITHOUT_PROGRESS || (state.announceNudgeTotal ?? 0) >= MAX_NUDGES_PER_SESSION) {
    log(`[${HOOK_NAME}] Skipped announce nudge: limit reached`, { sessionID, consecutive: state.announceNudgeConsecutive, total: state.announceNudgeTotal })
    return
  }
  const result = await dispatchInternalPrompt({
    mode: "async",
    client: ctx.client,
    sessionID,
    source: `${HOOK_NAME}:announce`,
    settleMs: 0,
    queueBehavior: "defer",
    semanticDedupeHoldMs: CONTINUATION_COOLDOWN_MS,
    input: {
      path: { id: sessionID },
      body: { agent, parts: [createInternalAgentContinuationTextPart(NUDGE_PROMPT)] },
      query: { directory: ctx.directory },
    },
  })
  if (!isInternalPromptDispatchAccepted(result)) {
    log(`[${HOOK_NAME}] Announce nudge not dispatched`, { sessionID, status: result.status })
    return
  }
  state.announceNudgeConsecutive = (state.announceNudgeConsecutive ?? 0) + 1
  state.announceNudgeTotal = (state.announceNudgeTotal ?? 0) + 1
  state.announceNudgeAtLength = messages.length
  log(`[${HOOK_NAME}] Announce nudge sent`, { sessionID, agent, total: state.announceNudgeTotal })
}
