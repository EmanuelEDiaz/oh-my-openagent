import { describe, expect, it } from "bun:test"

import { liveSkillDescription } from "../tools/skill/live-description"
import { createToolDefinitionHandler } from "./tool-definition"
import type { CreatedHooks } from "../create-hooks"

// OpenCode reads a plugin tool's description once, at registration (tool/registry.ts:142 in 1.18.26), before the
// skill tool knows OpenCode's native skills; tool.definition runs on every request (registry.ts:318).
describe("tool.definition gives the skill tool its current description (real config, 12-10-2026)", () => {
  it("replaces the registration-time description with the live one", async () => {
    liveSkillDescription.set(async () => "live description without native skills")
    const output = { description: "registration-time description with every skill", parameters: {} }
    await createToolDefinitionHandler({ hooks: {} as CreatedHooks })({ toolID: "skill" }, output)
    expect(output.description).toBe("live description without native skills")
    liveSkillDescription.set(undefined)
  })

  it("leaves other tools and an unknown description alone", async () => {
    const output = { description: "bash", parameters: {} }
    await createToolDefinitionHandler({ hooks: {} as CreatedHooks })({ toolID: "bash" }, output)
    expect(output.description).toBe("bash")
    const skill = { description: "registration-time", parameters: {} }
    await createToolDefinitionHandler({ hooks: {} as CreatedHooks })({ toolID: "skill" }, skill)
    expect(skill.description).toBe("registration-time")
  })
})
