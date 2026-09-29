import { describe, expect, test } from "bun:test"

import { buildDelegationTable } from "./dynamic-agent-core-sections"
import type { AvailableAgent } from "./dynamic-agent-prompt-builder"

function agent(name: string, requirement?: AvailableAgent["metadata"]["requirement"]): AvailableAgent {
  return {
    name,
    description: `${name} agent`,
    metadata: {
      category: "specialist",
      cost: "CHEAP",
      triggers: [{ domain: name, trigger: `do the ${name} task` }],
      ...(requirement ? { requirement } : {}),
    },
  }
}

describe("delegation table requirement markers", () => {
  test("marks mandatory specialists with their trigger and optional ones as optional", () => {
    // when
    const table = buildDelegationTable([
      agent("verifier", { level: "mandatory", when: "before claiming any work is done" }),
      agent("legacy"),
      agent("oracle", { level: "optional" }),
    ])

    // then
    expect(table).toContain("- **verifier** → `verifier` - do the verifier task — **MANDATORY before claiming any work is done**")
    expect(table).toContain("- **oracle** → `oracle` - do the oracle task — optional")
    expect(table).toContain("- **legacy** → `legacy` - do the legacy task\n")
  })

  test("keeps the routed-name token every row renders", () => {
    // when
    const table = buildDelegationTable([agent("verifier", { level: "mandatory", when: "always" })])

    // then
    expect([...table.matchAll(/→ `([^`]+)`/g)].map((match) => match[1])).toEqual(["verifier"])
  })
})
