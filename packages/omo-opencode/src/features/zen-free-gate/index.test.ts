import { describe, expect, test } from "bun:test"

import { applyZenFreeGate, hidesTool, isZenFreeModel, isZenGated } from "./index"

describe("Zen free-tier gate (04-10-2026)", () => {
  test("recognises free Zen models only", () => {
    expect(isZenFreeModel("opencode/big-pickle")).toBe(true)
    expect(isZenFreeModel("opencode/mimo-v2.6-flash-free")).toBe(true)
    expect(isZenFreeModel("opencode/claude-opus-5-5")).toBe(false)
    expect(isZenFreeModel("openrouter/deepseek-free")).toBe(false)
  })

  test("models OpenCode's rule: a tool is hidden when its last matching rule denies '*'", () => {
    expect(hidesTool({ bash: "deny" }, "bash")).toBe(true)
    expect(hidesTool({ "*": "deny", web_search: "allow" }, "read")).toBe(true)
    expect(hidesTool({ bash: { "*": "deny", "git diff*": "allow" } }, "bash")).toBe(false)
    expect(hidesTool({ edit: "deny" }, "bash")).toBe(false)
  })

  test("a read-only specialist on a free Zen model gets bash/read listed but every use denied, and is told so", () => {
    const agent = { model: "opencode/big-pickle", permission: { "*": "deny", web_search: "allow", bash: "deny" } as Record<string, unknown>, prompt: "You research." }
    expect(applyZenFreeGate("web-researcher", agent)).toEqual(["bash", "read"])
    expect(agent.permission["bash"]).toEqual({ "*": "deny", __omo_zen_free_tier_compat_never_matches__: "allow" })
    expect(hidesTool(agent.permission, "bash")).toBe(false)
    expect(agent.prompt).toContain("disabled for you")
    expect(isZenGated("web-researcher")).toBe(true)
  })

  test("other providers, and agents that already list both tools, are left untouched", () => {
    const paid = { model: "openrouter/x", permission: { bash: "deny" } as Record<string, unknown> }
    expect(applyZenFreeGate("api-lookup", paid)).toEqual([])
    expect(paid.permission).toEqual({ bash: "deny" })
    const explore = { model: "opencode/big-pickle", permission: { edit: "deny" } as Record<string, unknown> }
    expect(applyZenFreeGate("explore", explore)).toEqual([])
  })
})
