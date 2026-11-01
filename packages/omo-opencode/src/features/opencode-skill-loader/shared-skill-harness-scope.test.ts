import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { discoverSharedSkills } from "."

// `<ulw-execute-blocked-external>` is a machine-consumed sentinel, not prose: the Codex Stop hook
// greps for it in `hasAllowedExternalBlockerMarker()` and ends the turn when it appears. No
// OpenCode code path reads it - `handleAtlasSessionIdle()` decides purely from Boulder progress
// and tool iterations - so telling an OpenCode agent to emit it produces a stop that OpenCode
// ignores, and the continuation loop keeps going. The contract therefore belongs to the Codex
// channel only (the ulw-execute-continuation component directive), never to the shared bundle
// that OpenCode loads verbatim.
const CODEX_ONLY_STOP_MARKER = "<ulw-execute-blocked-external>"

describe("shared skills reaching the OpenCode harness", () => {
  test("#given the shared ulw-execute skill #when OpenCode discovers it #then it carries no Codex-only stop marker", async () => {
    // given
    const sharedSkills = await discoverSharedSkills()
    const ulwExecute = sharedSkills.find((skill) => skill.name === "ulw-execute")

    // when
    const content = (await ulwExecute?.lazyContent?.load()) ?? ""

    // then
    expect(ulwExecute).toBeDefined()
    expect(content.length).toBeGreaterThan(0)
    expect(content).not.toContain(CODEX_ONLY_STOP_MARKER)
  })
})

// Fork incident H51: in OpenCode, Prometheus told the user to run `$ulw-execute`, the Codex spelling; OpenCode's
// command is `/ulw-execute` (builtin-commands). Codex ships its own ulw-plan (components/ultrawork), so the shared one
// reaches OpenCode only; ulw-execute reaches both harnesses and must name the OpenCode command too.
describe("commands that shared skills tell an OpenCode user to type", () => {
  const skillsRoot = join(import.meta.dir, "../../../../shared-skills/skills")
  const markdownOf = (skill: string): string => {
    const dir = join(skillsRoot, skill)
    const refs = join(dir, "references")
    const files = [join(dir, "SKILL.md"), ...(() => {
      try {
        return readdirSync(refs).filter((name) => name.endsWith(".md")).map((name) => join(refs, name))
      } catch {
        return []
      }
    })()]
    return files.map((file) => readFileSync(file, "utf8")).join("\n")
  }

  test("#given the OpenCode-only shared ulw-plan #then it never names the Codex `$ulw-execute` invocation", () => {
    const text = markdownOf("ulw-plan")
    expect(text).toContain("/ulw-execute")
    expect(text).not.toMatch(/\$ulw-execute\b/)
  })

  test("#given the shared ulw-execute, read by both harnesses #then its usage names the OpenCode command", () => {
    expect(markdownOf("ulw-execute")).toMatch(/^\/ulw-execute \[plan-name\]/m)
  })
})
