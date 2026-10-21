/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { LoadedSkill } from "../../../features/opencode-skill-loader/types"
import { createMockSkill, createSkillTool, mockContext } from "./test-support"

describe("skill tool - nativeSkills integration", () => {
  // Native skills are already in OpenCode's own <available_skills>: the description does not repeat them (user
  // decision 07-10-2026, context cut), but the tool still loads them. These two tests asserted the old repetition.
  it("does not repeat native skills in the description, and still loads them, when skills are pre-seeded", async () => {
    const tool = createSkillTool({
      skills: [createMockSkill("seeded-skill")],
      includeSkillsInDescription: true,
      nativeSkills: {
        all() {
          return [{
            name: "native-visible-skill",
            description: "Native skill exposed from config",
            location: "/external/skills/native-visible-skill/SKILL.md",
            content: "Native visible skill body",
          }]
        },
        get() { return undefined },
        dirs() { return [] },
      },
    })

    expect(tool.description).toContain("seeded-skill")
    expect(tool.description).not.toContain("native-visible-skill")
    expect(tool.description).toContain("not repeated here")
    expect(String(await tool.execute({ name: "native-visible-skill" }, mockContext))).toContain("Native visible skill body")

    expect(tool.description).toContain("seeded-skill")
    expect(tool.description).not.toContain("native-visible-skill")
  })

  it("does not repeat OpenCode-injected native skills after the shared/ prefix cutover", () => {
    const tool = createSkillTool({
      skills: [],
      includeSkillsInDescription: true,
      nativeSkills: {
        all() {
          return [
            {
              name: "opencode/customize-opencode",
              description: "Qualified OpenCode customize entry",
              location: "<built-in>",
              content: "Qualified customize body",
            },
            {
              name: "customize-opencode",
              description: "Customize OpenCode",
              location: "<built-in>",
              content: "Customize body",
            },
          ]
        },
        get() { return undefined },
        dirs() { return [] },
      },
    })

    const description = tool.description

    expect(description).not.toContain("<name>/customize-opencode</name>")
    expect(description).toContain("not repeated here")
  })

  it("merges native skills exposed by PluginInput.skills.all()", async () => {
    const tool = createSkillTool({
      skills: [],
      nativeSkills: {
        async all() {
          return [{
            name: "external-plugin-skill",
            description: "Skill from config.skills.paths",
            location: "/external/skills/external-plugin-skill/SKILL.md",
            content: "External plugin skill body",
          }]
        },
        async get() { return undefined },
        async dirs() { return [] },
      },
    })

    const result = await tool.execute({ name: "external-plugin-skill" }, mockContext)

    expect(result).toContain("external-plugin-skill")
    expect(result).toContain("External plugin skill body")
  })

  it("does not reintroduce disabled native skills from PluginInput.skills.all()", async () => {
    const tool = createSkillTool({
      directory: "/test",
      skills: [],
      disabledSkills: new Set(["blocked-native-skill"]),
      includeSkillsInDescription: true,
      nativeSkills: {
        all() {
          return [{
            name: "blocked-native-skill",
            description: "Blocked native skill from config.skills.paths",
            location: "/external/skills/blocked-native-skill/SKILL.md",
            content: "BYPASS_CONFIRMED",
          }]
        },
        get() { return undefined },
        dirs() { return [] },
      },
    })

    expect(tool.description).not.toContain("blocked-native-skill")
    await expect(tool.execute({ name: "blocked-native-skill" }, mockContext)).rejects.toThrow(
      'Skill or command "blocked-native-skill" not found',
    )
  })
})
