import { describe, expect, test } from "bun:test"

import { parseModel } from "../../shared/session-target"
import { createParentLookup } from "./plugin-deps"

describe("parseModel", () => {
  test("splits provider, model and optional variant", () => {
    expect(parseModel("opencode/big-pickle")).toEqual({ providerID: "opencode", modelID: "big-pickle" })
    expect(parseModel("openai/gpt-5.4(high)")).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "high" })
    expect(parseModel("ollama/qwen3:8b")).toEqual({ providerID: "ollama", modelID: "qwen3:8b" })
    expect(parseModel("nope")).toBeUndefined()
  })
})

describe("createParentLookup", () => {
  test("#given a session with a parent #then it is a subagent, asked from OpenCode once", async () => {
    const asked: string[] = []
    const lookup = createParentLookup({ session: { get: async ({ path }) => (asked.push(path.id), { data: path.id === "ses_child" ? { parentID: "ses_main" } : {} }) } })
    expect(await lookup("ses_child")).toBe(true)
    expect(await lookup("ses_child")).toBe(true)
    expect(await lookup("ses_main")).toBe(false)
    expect(asked).toEqual(["ses_child", "ses_main"])
  })

  test("#given the lookup fails #then it rejects and the next call asks again", async () => {
    let calls = 0
    const lookup = createParentLookup({ session: { get: async () => { calls += 1; if (calls === 1) throw new Error("down"); return { data: { parentID: "p" } } } } })
    await expect(lookup("ses_x")).rejects.toThrow("down")
    expect(await lookup("ses_x")).toBe(true)
  })
})
