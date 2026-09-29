import { describe, expect, test } from "bun:test"

import { createAtlasAgent, getAtlasPromptSource } from "./agent"

const ONE_MODEL_PER_VARIANT = [
  "anthropic/claude-opus-4-7",
  "openai/gpt-5.6-sol",
  "google/gemini-3.1-pro",
  "opencode-go/kimi-k3",
  "opencode-go/kimi-k2.7",
  "opencode-go/kimi-k2.5",
  "zai-coding-plan/glm-5.2",
  "anthropic/claude-sonnet-4-6",
]

describe("Atlas execution policy (fork 2.2)", () => {
  test("covers all eight prompt variants", () => {
    expect(new Set(ONE_MODEL_PER_VARIANT.map((model) => getAtlasPromptSource(model))).size).toBe(8)
  })

  for (const model of ONE_MODEL_PER_VARIANT) {
    test(`${getAtlasPromptSource(model)} ends with one consistent execution policy`, () => {
      // when
      const prompt = createAtlasAgent({ model }).prompt ?? ""
      const policy = prompt.slice(prompt.indexOf("## Execution policy"))

      // then
      expect(prompt).not.toContain("Retry 3x")
      expect(prompt.lastIndexOf("## Execution policy")).toBeGreaterThan(prompt.length / 2)
      expect(policy).toContain("citation")
      expect(policy).toContain("blocked")
      expect(policy).toContain("ask the user")
      expect(policy).toContain("outside the plan's area")
      expect(policy).toContain("`docs-writer` when the change")
      expect(policy).toContain("`security-reviewer` when it touches auth")
    })
  }
})
