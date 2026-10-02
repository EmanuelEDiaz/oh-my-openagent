import { describe, expect, test } from "bun:test"

import type { OhMyOpenCodeConfig } from "../../config"
import { getFallbackModelsForSession } from "./fallback-models"

describe("fallback models for agents given by display name (fork 0.8a)", () => {
  test("a display name resolves to the agent's config key", () => {
    const config = { agents: { sisyphus: { fallback_models: ["opencode/big-pickle"] } } } as unknown as OhMyOpenCodeConfig
    expect(getFallbackModelsForSession("ses_x", "Sisyphus - ultraworker", config)).toEqual(["opencode/big-pickle"])
  })
})
