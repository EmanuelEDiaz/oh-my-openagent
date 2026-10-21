import { describe, expect, test } from "bun:test"

import type { ToolReport } from "./check"
import { EXTERNAL_TOOLS } from "./inventory"
import { doctorIssues, doctorLines, startupNotice } from "./report"

const tool = (id: string) => {
  const found = EXTERNAL_TOOLS.find((candidate) => candidate.id === id)
  if (!found) throw new Error(id)
  return found
}
const report = (id: string, status: ToolReport["status"], detail = "d"): ToolReport => ({ tool: tool(id), status, detail })

describe("external tools report", () => {
  test("#given everything connects #then there is no startup notice and no doctor issue", () => {
    const reports = [report("typescript-language-server", "connects"), report("git", "connects")]
    expect(startupNotice(reports)).toBeUndefined()
    expect(doctorIssues(reports)).toEqual([])
  })

  test("#given the TypeScript server does not connect #then the notice names it and points at doctor", () => {
    const notice = startupNotice([report("typescript-language-server", "fails"), report("git", "connects")])
    expect(notice).toContain("TypeScript language server")
    expect(notice).toContain("oh-my-openagent doctor")
  })

  test("#given only an optional tool is missing #then there is no startup notice but doctor lists it", () => {
    const reports = [report("tmux", "missing")]
    expect(startupNotice(reports)).toBeUndefined()
    expect(doctorIssues(reports)).toHaveLength(1)
  })

  test("#given a missing TypeScript server #then the fix pins version 6 and says how to keep it across Node upgrades", () => {
    const [issue] = doctorIssues([report("typescript-language-server", "missing")], "linux")
    expect(issue?.fix).toContain("typescript@6")
    expect(issue?.fix).toContain("postinstall")
  })

  test("#given Windows #then the Windows install command is offered", () => {
    const [issue] = doctorIssues([report("git", "missing")], "win32")
    expect(issue?.fix).toContain("winget")
  })

  test("#given several reports #then doctor shows one line per tool with its state", () => {
    expect(doctorLines([report("git", "connects", "/usr/bin/git"), report("tmux", "missing", "tmux not found")])).toEqual([
      "✓ git: connects — /usr/bin/git",
      "✗ tmux: not installed — tmux not found",
    ])
  })
})
