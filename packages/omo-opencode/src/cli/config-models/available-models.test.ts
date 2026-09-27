/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { listAvailableModels, parseOpenCodeModelsOutput } from "./available-models"

describe("parseOpenCodeModelsOutput", () => {
  test("keeps provider/model lines and drops noise", () => {
    // given
    const output = "Loading...\nopencode/big-pickle\n\n  anthropic/claude-opus-5  \nnot a model\n"

    // when
    const models = parseOpenCodeModelsOutput(output)

    // then
    expect(models).toEqual(["opencode/big-pickle", "anthropic/claude-opus-5"])
  })
})

describe("listAvailableModels", () => {
  test("prefers the opencode CLI list, deduplicated and sorted", () => {
    // given
    const runOpenCodeModels = () => "opencode/b\nopencode/a\nopencode/b\n"

    // when
    const result = listAvailableModels({ runOpenCodeModels, readModelsCache: () => null })

    // then
    expect(result).toEqual({ models: ["opencode/a", "opencode/b"], source: "opencode-cli" })
  })

  test("falls back to the models.dev cache when the CLI is unavailable", () => {
    // given
    const cache = JSON.stringify({ zai: { models: { "glm-5": {} } }, opencode: { models: { "big-pickle": {} } } })

    // when
    const result = listAvailableModels({ runOpenCodeModels: () => null, readModelsCache: () => cache })

    // then
    expect(result).toEqual({ models: ["opencode/big-pickle", "zai/glm-5"], source: "models-cache" })
  })

  test("reports no source when nothing can be read", () => {
    // when
    const result = listAvailableModels({ runOpenCodeModels: () => null, readModelsCache: () => "{broken" })

    // then
    expect(result).toEqual({ models: [], source: "none" })
  })
})
