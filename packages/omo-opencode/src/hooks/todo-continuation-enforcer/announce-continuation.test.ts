/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { handleSessionIdle } from "./idle-event"
import type { SessionStateStore } from "./session-state"
import type { SessionState } from "./types"

const ANNOUNCED = "Los resultados apuntan a desajustes esquema↔entidad. Voy a verificarlo leyendo entidades, DDL y adaptadores."

function setup(agent: string, state: Partial<SessionState> = {}) {
  const sessionState: SessionState = { stagnationCount: 0, consecutiveFailures: 0, ...state }
  const prompts: unknown[] = []
  const store: SessionStateStore = {
    getState: () => sessionState,
    getExistingState: () => sessionState,
    startPruneInterval: () => {},
    trackContinuationProgress: () => ({ previousStagnationCount: 0, stagnationCount: 0, hasProgressed: false, progressSource: "none" as const }),
    resetContinuationProgress: () => {},
    cancelCountdown: () => {},
    cleanup: () => {},
    cancelAllCountdowns: () => {},
    shutdown: () => {},
  }
  const messages = [
    { info: { role: "user" }, parts: [{ type: "text", text: "arregla las ventas" }] },
    // A finished assistant turn, as OpenCode stores it (finish + completion time).
    { info: { role: "assistant", agent, finish: "stop", time: { created: 1, completed: 2 } }, parts: [{ type: "text", text: ANNOUNCED }] },
  ]
  const ctx = {
    directory: "/tmp/test",
    client: {
      session: {
        messages: async () => ({ data: messages }),
        todo: async () => ({ data: [] }),
        promptAsync: async (input: unknown) => {
          prompts.push(input)
          return {}
        },
      },
    },
  }
  return { ctx, store, sessionState, prompts }
}

// Fork incident H58 (user decision 12-11-2026, "empujón con límites").
describe("announce continuation: an agent that announced its next step and stopped is nudged once", () => {
  afterEach(() => releaseAllPromptAsyncReservationsForTesting())

  it("nudges a tab agent with no todos once", async () => {
    // given
    const { ctx, store, sessionState, prompts } = setup("Sisyphus - ultraworker")

    // when
    await handleSessionIdle({ ctx: ctx as never, sessionID: "ses_a", sessionStateStore: store, announceContinuation: true })

    // then
    expect(prompts).toHaveLength(1)
    expect(sessionState.announceNudgeTotal).toBe(1)
  })

  it.each([
    ["the user stopped continuation", "Sisyphus - ultraworker", {}, true, () => true],
    ["a subagent", "explore", {}, true, undefined],
    ["a nudge already given without progress since", "Sisyphus - ultraworker", { announceNudgeConsecutive: 1, announceNudgeAtLength: 2 }, true, undefined],
    ["three nudges in the session", "Sisyphus - ultraworker", { announceNudgeTotal: 3 }, true, undefined],
    ["the switch off", "Sisyphus - ultraworker", {}, false, undefined],
  ] as const)("does not nudge when %s", async (_name, agent, state, enabled, stopped) => {
    // given
    const { ctx, store, prompts } = setup(agent, state)

    // when
    await handleSessionIdle({ ctx: ctx as never, sessionID: "ses_b", sessionStateStore: store, announceContinuation: enabled, ...(stopped ? { isContinuationStopped: stopped } : {}) })

    // then
    expect(prompts).toHaveLength(0)
  })
})
