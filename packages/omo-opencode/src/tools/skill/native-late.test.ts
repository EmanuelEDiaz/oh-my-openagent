/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { liveSkillDescription } from "./live-description"
import { createSkillTool } from "./tools"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

// Real config, 12-10-2026: at plugin start OpenCode is not answering yet, so the native skill list failed (and the
// error was swallowed). The description handed out per request must load it once OpenCode answers.
const seeded: LoadedSkill = {
  name: "git-master",
  path: "/s/git-master/SKILL.md",
  resolvedPath: "/s/git-master",
  definition: { name: "git-master", description: "plugin skill", template: "body" },
  scope: "builtin",
}

describe("native skills that OpenCode can list only after startup", () => {
  it("the per-request description drops them once OpenCode answers", async () => {
    let ready = false
    createSkillTool({
      skills: [seeded, { ...seeded, name: "debugging", definition: { ...seeded.definition, name: "debugging" } }],
      includeSkillsInDescription: true,
      nativeSkills: {
        async all() {
          if (!ready) throw new Error("server not ready")
          return [{ name: "debugging", description: "native", location: "/home/u/.claude/skills/debugging/SKILL.md", content: "x" }]
        },
        async get() { return undefined },
        dirs() { return [] },
      },
    })
    // at startup the list fails: the native skill is still listed
    await Bun.sleep(20)
    ready = true

    const description = await liveSkillDescription.get()
    expect(description).toContain("/git-master")
    expect(description).not.toContain("<name>/debugging</name>")
    expect(description).toContain("not repeated here")
  })

  it("a native list that keeps failing never breaks the description (the failure is only logged)", async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      createSkillTool({
        skills: [seeded],
        includeSkillsInDescription: true,
        nativeSkills: { async all() { throw new Error("server not ready") }, async get() { return undefined }, dirs() { return [] } },
      })
      const description = await liveSkillDescription.get()
      expect(description).toContain("/git-master")
      await Bun.sleep(20)
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})
