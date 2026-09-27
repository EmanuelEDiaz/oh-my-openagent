/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { rankModels } from "./model-ranking"
import { buildOllamaProviderConfig, detectOllama, parseParameterSize, resolveOllamaUrl, toOllamaModelInfo } from "./ollama"

describe("detectOllama", () => {
  test("reads installed models with context, size and capabilities from the Ollama API", async () => {
    // given
    const calls: string[] = []
    const fetchJson = async (url: string, body?: unknown): Promise<unknown> => {
      calls.push(body === undefined ? url : `${url} ${JSON.stringify(body)}`)
      if (url.endsWith("/api/tags")) return { models: [{ name: "qwen3.5:4b" }] }
      return {
        details: { parameter_size: "4.0B" },
        capabilities: ["completion", "tools", "thinking"],
        model_info: { "qwen35.context_length": 262_144 },
      }
    }

    // when
    const detection = await detectOllama({ baseUrl: "http://ollama.test", fetchJson })

    // then
    expect(detection.reachable).toBe(true)
    expect(detection.models).toEqual([
      { name: "qwen3.5:4b", contextTokens: 262_144, parameterBillions: 4, capabilities: ["completion", "tools", "thinking"] },
    ])
    expect(calls).toEqual(["http://ollama.test/api/tags", 'http://ollama.test/api/show {"model":"qwen3.5:4b"}'])
  })

  test("reports unreachable instead of throwing when Ollama is not running", async () => {
    // when
    const detection = await detectOllama({
      baseUrl: "http://ollama.test",
      fetchJson: async () => {
        throw new Error("ECONNREFUSED")
      },
    })

    // then
    expect(detection).toEqual({ baseUrl: "http://ollama.test", reachable: false, models: [] })
  })

  test("does not call the network when detection is disabled", async () => {
    // given
    let called = false

    // when
    const detection = await detectOllama({ baseUrl: null, fetchJson: async () => {
      called = true
      return {}
    } })

    // then
    expect(called).toBe(false)
    expect(detection).toEqual({ baseUrl: "off", reachable: false, models: [] })
  })
})

describe("resolveOllamaUrl", () => {
  test("honors OMO_OLLAMA_URL=off, OLLAMA_HOST without scheme, and the default", () => {
    // then
    expect(resolveOllamaUrl({ OMO_OLLAMA_URL: "off" })).toBeNull()
    expect(resolveOllamaUrl({ OLLAMA_HOST: "127.0.0.1:11500/" })).toBe("http://127.0.0.1:11500")
    expect(resolveOllamaUrl({})).toBe("http://localhost:11434")
  })
})

describe("Ollama model info", () => {
  const small = { name: "qwen3.5:4b", contextTokens: 32_768, parameterBillions: 4, capabilities: ["completion", "tools", "vision"] }

  test("maps capabilities to free, image-capable, tool-calling metadata", () => {
    // when
    const info = toOllamaModelInfo(small)

    // then
    expect(info.id).toBe("ollama/qwen3.5:4b")
    expect(info.costInput).toBe(0)
    expect(info.inputModalities).toEqual(["text", "image"])
    expect(info.toolCall).toBe(true)
  })

  test("warns that small local models often fail at tool use", () => {
    // when
    const [ranked] = rankModels("explore", ["ollama/qwen3.5:4b"], new Map([["ollama/qwen3.5:4b", toOllamaModelInfo(small)]]))

    // then
    expect(ranked?.warnings).toContain("small local model (4B): often fails at tool use")
  })

  test("builds an OpenAI-compatible provider block with context limits", () => {
    // when
    const block = buildOllamaProviderConfig("http://ollama.test", [small])

    // then
    expect(block).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "Ollama (local)",
      options: { baseURL: "http://ollama.test/v1" },
      models: { "qwen3.5:4b": { name: "qwen3.5:4b", limit: { context: 32_768, output: 8192 } } },
    })
    expect(parseParameterSize("807.00M")).toBeCloseTo(0.807)
  })
})
