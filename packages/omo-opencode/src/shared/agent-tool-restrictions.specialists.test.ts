import { describe, expect, test } from "bun:test"

import { SPECIALISTS } from "../agents/specialists/catalog"
import { buildSyncPromptTools } from "../tools/delegate-task/sync-prompt-sender"
import { getAgentToolRestrictions } from "./agent-tool-restrictions"

describe("specialists never delegate, even through the per-prompt tool map (fork 4.18)", () => {
  test("every specialist gets task and call_omo_agent denied after the default call_omo_agent: true", () => {
    for (const spec of SPECIALISTS) {
      const tools = buildSyncPromptTools(spec.name)
      expect(`${spec.name}:${tools["call_omo_agent"]}`).toBe(`${spec.name}:false`)
      expect(`${spec.name}:${tools["task"]}`).toBe(`${spec.name}:false`)
    }
  })

  test("web-researcher sees only its four tools: '*' denied first, its tools allowed after (last match wins)", () => {
    const entries = Object.entries(getAgentToolRestrictions("web-researcher"))
    const star = entries.findIndex(([name]) => name === "*")
    expect(entries[star]?.[1]).toBe(false)
    for (const name of ["web_search", "web_read", "registry_lookup", "web_answer"]) {
      const index = entries.findIndex(([key]) => key === name)
      expect(index).toBeGreaterThan(star)
      expect(entries[index]?.[1]).toBe(true)
    }
  })

  test("orchestrators keep their tools", () => {
    expect(getAgentToolRestrictions("sisyphus")["call_omo_agent"]).toBeUndefined()
  })
})
