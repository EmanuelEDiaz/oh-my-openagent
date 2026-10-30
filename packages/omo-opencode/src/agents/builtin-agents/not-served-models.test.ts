/// <reference types="bun-types" />

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as shared from "../../shared"
import { resetAgentRegistrationReport, takeAgentRegistrationIssues } from "../../shared/agent-registration-report"
import { markModelBroken } from "../../shared/broken-models-cache"
import { createBuiltinAgents } from "../builtin-agents"

type Spy = { mockRestore: () => void }

// Real-use incidents 07-10-2026 (fork plan real-use-incidents A4): librarian/explore had a retired primary.
const RETIRED = "opencode/deepseek-v4-flash-free"
const NOT_SERVED = "opencode/ling-3.0-flash-fin-free"

describe("librarian/explore walk their own fallbacks and skip models that are not served", () => {
  let spies: Spy[] = []
  let cacheHome: string
  let previousCacheHome: string | undefined

  function environment(available: string[]): void {
    spies = [
      spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["opencode"]),
      spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null),
      spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set(available)),
    ]
  }

  beforeEach(() => {
    resetAgentRegistrationReport()
    previousCacheHome = process.env.XDG_CACHE_HOME
    cacheHome = mkdtempSync(join(tmpdir(), "omo-broken-models-"))
    process.env.XDG_CACHE_HOME = cacheHome
  })
  afterEach(() => {
    spies.forEach((spy) => spy.mockRestore())
    if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = previousCacheHome
    rmSync(cacheHome, { recursive: true, force: true })
  })

  test("librarian with a retired primary uses its own fallback_models entry, not the session model", async () => {
    // given
    environment(["opencode/big-pickle", "opencode/north-mini-code-free"])

    // when
    const agents = await createBuiltinAgents([], {
      librarian: { model: RETIRED, fallback_models: [{ model: "opencode/north-mini-code-free" }] },
    })

    // then
    expect(agents.librarian?.model).toBe("opencode/north-mini-code-free")
  })

  test("a configured model that is listed but not served is replaced by the next fallback and reported as such", async () => {
    // given
    environment([NOT_SERVED, "opencode/big-pickle"])
    markModelBroken(NOT_SERVED, "Cannot find any route matching [POST] https://opencode.ai/zen/v1/chat/completions")

    // when
    const agents = await createBuiltinAgents([], {
      explore: { model: NOT_SERVED, fallback_models: ["opencode/big-pickle"] },
    })

    // then
    expect(agents.explore?.model).toBe("opencode/big-pickle")
    const issue = takeAgentRegistrationIssues().find((entry) => entry.agent === "explore")
    expect(issue?.status).toBe("replaced")
    expect(issue?.detail).toContain("not served")
  })

  test("a not-served fallback is skipped too", async () => {
    // given
    environment(["opencode/space-bunny-free", "opencode/big-pickle"])
    markModelBroken("opencode/space-bunny-free", "Cannot find any route")

    // when
    const agents = await createBuiltinAgents([], {
      librarian: { model: RETIRED, fallback_models: ["opencode/space-bunny-free", "opencode/big-pickle"] },
    })

    // then
    expect(agents.librarian?.model).toBe("opencode/big-pickle")
  })
})
