import { describe, expect, test } from "bun:test"

import { formatAgentRegistrationWarning } from "./agent-registration-warning"

describe("agent registration warning (fork 0.3)", () => {
  test("says which agents run on the session model, which are off, and how to fix it", () => {
    // when
    const message = formatAgentRegistrationWarning([
      { agent: "atlas", status: "degraded", detail: "x" },
      { agent: "sisyphus", status: "degraded", detail: "x" },
      { agent: "hephaestus", status: "skipped", detail: "Hephaestus needs a GPT model: set agents.hephaestus.model" },
    ])

    // then
    expect(message).toContain("No configured model for: atlas, sisyphus — they use your session model.")
    expect(message).toContain("hephaestus is off: Hephaestus needs a GPT model")
    expect(message).toContain("/omo-models")
  })

  test("stays silent when every agent resolved a model", () => {
    expect(formatAgentRegistrationWarning([])).toBeUndefined()
  })

  test("keeps long lists short", () => {
    // when
    const message = formatAgentRegistrationWarning(
      Array.from({ length: 9 }, (_, index) => ({ agent: `agent-${index}`, status: "degraded" as const, detail: "x" })),
    )

    // then
    expect(message).toContain("agent-5 +3")
  })
})
