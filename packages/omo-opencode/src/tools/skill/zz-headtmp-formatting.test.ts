// @ts-nocheck
import { describe, expect, it } from "bun:test"
import { formatCombinedDescription } from "./zz-headtmp-formatter"
import type { CommandInfo } from "../slashcommand/types"
import type { SkillInfo } from "./types"
import {
  builtinSharedSkill,
  makeCommand,
  makeSkill,
  sharedSkill,
} from "./description-formatter.test-support"

describe("formatCombinedDescription with bare-name skills", () => {
  it("lists all skills when no name collisions exist", () => {
    const skills: SkillInfo[] = [
      makeSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = formatCombinedDescription(skills, [], { includeSkills: true })
    expect(result).toContain("/debugging")
    expect(result).toContain("/review-work")
  })

  it("keeps bare and qualified names distinct after the shared/ cutover", () => {
    const skills: SkillInfo[] = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = formatCombinedDescription(skills, [], { includeSkills: true })
    expect(result).toContain("/shared/debugging")
    expect(result).toContain("/debugging")
    expect(result).toContain("/review-work")
  })

  it("suppresses builtin commands that share an exact name with a skill", () => {
    const skills: SkillInfo[] = [
      makeSkill("refactor", "full refactor skill"),
      makeSkill("remove-ai-slops", "full cleanup skill"),
      makeSkill("ulw-execute", "full ulw-execute skill"),
    ]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "short refactor command"),
      makeCommand("remove-ai-slops", "short cleanup command"),
      makeCommand("ulw-execute", "short ulw-execute command"),
      makeCommand("handoff", "handoff command"),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })
    expect(result).toContain("/refactor")
    expect(result).toContain("/remove-ai-slops")
    expect(result).toContain("/ulw-execute")
    expect(result).not.toContain("short refactor command")
    expect(result).not.toContain("short cleanup command")
    expect(result).not.toContain("short ulw-execute command")
    expect(result).toContain("/handoff")
  })

  it("does not suppress builtin commands when no skill shares the exact name", () => {
    const skills: SkillInfo[] = [makeSkill("debugging")]
    const commands: CommandInfo[] = [makeCommand("refactor", "short refactor command")]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })
    expect(result).toContain("/debugging")
    expect(result).toContain("/refactor")
    expect(result).toContain("short refactor command")
  })
})

describe("formatCombinedDescription with skills OpenCode already lists (incidents 07-10-2026)", () => {
  it("lists only the skills missing from OpenCode's <available_skills>, and says why", () => {
    const skills: SkillInfo[] = [makeSkill("git-master"), makeSkill("my-disk-skill"), makeSkill("Other-Disk-Skill")]
    const commands: CommandInfo[] = [makeCommand("handoff", "handoff command")]

    const result = formatCombinedDescription(skills, commands, {
      includeSkills: true,
      excludeSkillNames: new Set(["my-disk-skill", "other-disk-skill"]),
    })

    expect(result).toContain("/git-master")
    expect(result).not.toContain("my-disk-skill")
    expect(result).not.toContain("Other-Disk-Skill")
    expect(result).toContain("/handoff")
    expect(result).toContain("not repeated here")
  })

  it("still suppresses a builtin command aliasing a skill that OpenCode lists", () => {
    const skills: SkillInfo[] = [makeSkill("debugging")]
    const commands: CommandInfo[] = [makeCommand("debugging", "short debugging command")]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true, excludeSkillNames: new Set(["debugging"]) })
    expect(result).not.toContain("short debugging command")
  })
})
