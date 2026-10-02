import { describe, expect, test } from "bun:test"

import { parseModel } from "./plugin-deps"

describe("parseModel", () => {
  test("splits provider, model and optional variant", () => {
    expect(parseModel("opencode/big-pickle")).toEqual({ providerID: "opencode", modelID: "big-pickle" })
    expect(parseModel("openai/gpt-5.4(high)")).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "high" })
    expect(parseModel("ollama/qwen3:8b")).toEqual({ providerID: "ollama", modelID: "qwen3:8b" })
    expect(parseModel("nope")).toBeUndefined()
  })
})
