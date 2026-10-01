import { describe, expect, it } from "bun:test"
import type { ToolsSummary } from "../framework/types"
import { buildToolIssues } from "./tools"

function completeSummary(overrides: Partial<ToolsSummary> = {}): ToolsSummary {
    return {
      astGrepCli: true,
      commentChecker: true,
    ghCli: { authenticated: true, installed: true, username: "octocat" },
    lspServers: [{ extensions: [".ts"], id: "typescript" }],
    mcpBuiltin: [],
    mcpUser: [],
    ...overrides,
  }
}

describe("buildToolIssues", () => {
  it("#given no ast-grep CLI #when building issues #then references the ast-grep skill instead of MCP tool names", () => {
    // given
    const summary = completeSummary({ astGrepCli: false })

    // when
    const issues = buildToolIssues(summary)

    // then
    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe("AST-Grep unavailable")
    expect(issues[0]?.affects).toEqual(["ast-grep skill"])
    expect(issues[0]?.fix).toContain("ast-grep skill")
    expect(issues[0]?.fix).toContain("sg automatically")
  })
})

describe("comment-checker status (fork 0.6)", () => {
  it("#given the binary was simply not downloaded yet #then it is not reported as a problem", () => {
    // when
    const issues = buildToolIssues(completeSummary({ commentChecker: false }))

    // then
    expect(issues.some((issue) => issue.title === "Comment checker unavailable")).toBe(false)
  })

  it("#given the last download failed #then the issue shows the recorded error", () => {
    // when
    const issues = buildToolIssues(completeSummary({
      commentChecker: false,
      commentCheckerDownloadFailure: "getaddrinfo ENOTFOUND github.com (2026-10-01T10:00:00.000Z)",
    }))

    // then
    const issue = issues.find((entry) => entry.title === "Comment checker unavailable")
    expect(issue?.description).toContain("getaddrinfo ENOTFOUND github.com")
  })
})
