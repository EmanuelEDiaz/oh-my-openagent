import { describe, expect, spyOn, test } from "bun:test"

import * as shared from "../../shared"
import { createBuiltinAgents } from "../builtin-agents"
import { SPECIALISTS } from "./catalog"
import { createSpecialistAgent } from "./factory"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-8"
const FILE_WRITING_TOOLS = ["write", "edit", "apply_patch", "multiedit", "hashline_edit"]
const WRITERS = new Set(["test-writer", "docs-writer"])

function permissionOf(name: string): Record<string, unknown> {
  const spec = SPECIALISTS.find((candidate) => candidate.name === name)
  if (!spec) throw new Error(`no specialist ${name}`)
  return (createSpecialistAgent(spec)("test/model").permission ?? {}) as Record<string, unknown>
}

describe("specialists catalog", () => {
  test("defines the approved atomic specialists", () => {
    // then
    expect(SPECIALISTS.map((spec) => spec.name).sort()).toEqual([
      "api-lookup", "architect-reviewer", "debugger", "dependency-check", "docs-writer", "git-committer", "lang-reviewer",
      "memory", "security-reviewer", "test-reviewer", "test-writer", "ui-tester", "verifier",
    ])
  })

  test("every specialist is a subagent that cannot delegate and declares whether it is mandatory", () => {
    for (const spec of SPECIALISTS) {
      // when
      const config = createSpecialistAgent(spec)("test/model")

      // then
      expect(config.mode).toBe("subagent")
      expect((config.permission as Record<string, unknown>)["task"]).toBe("deny")
      expect(spec.metadata.requirement).toBeDefined()
      if (spec.metadata.requirement?.level === "mandatory") expect(spec.metadata.requirement.when.length).toBeGreaterThan(10)
    }
  })

  test("only the writers may modify files, and nobody but them", () => {
    for (const spec of SPECIALISTS) {
      // when
      const permission = permissionOf(spec.name)

      // then
      for (const tool of FILE_WRITING_TOOLS) {
        expect(`${spec.name}:${tool}=${String(permission[tool])}`).toBe(`${spec.name}:${tool}=${WRITERS.has(spec.name) ? "allow" : "deny"}`)
      }
    }
  })

  test("git-committer and verifier get bash without push or destructive git", () => {
    // when
    const committer = permissionOf("git-committer")["bash"] as Record<string, string>
    const verifier = permissionOf("verifier")["bash"] as Record<string, string>

    // then
    expect(committer["git push*"]).toBe("deny")
    expect(committer["git reset --hard*"]).toBe("deny")
    expect(verifier["git push*"]).toBe("deny")
    expect(permissionOf("api-lookup")["bash"]).toBe("deny")
    for (const pattern of ["*--no-verify*", "*--force*", "git add -A*", "git add .", "git add --all*"]) {
      expect(`${pattern}=${committer[pattern]}`).toBe(`${pattern}=deny`)
    }
  })

  test("reviewers may run their free scanners when installed, never install them", () => {
    // when
    const security = permissionOf("security-reviewer")["bash"] as Record<string, string>
    const tests = permissionOf("test-reviewer")["bash"] as Record<string, string>

    // then
    expect(security["gitleaks*"]).toBe("allow")
    expect(security["osv-scanner*"]).toBe("allow")
    expect(security["command -v*"]).toBe("allow")
    expect(tests["mutmut*"]).toBe("allow")
    for (const bash of [security, tests]) {
      expect(bash["npm install*"]).toBe("deny")
      expect(bash["pip install*"]).toBe("deny")
    }
  })

  test("prompts carry the researched guards", () => {
    const prompt = (name: string) => createSpecialistAgent(SPECIALISTS.find((spec) => spec.name === name)!)("m").prompt ?? ""
    expect(prompt("verifier")).toContain("FLAKY")
    expect(prompt("verifier")).toContain("baseline")
    expect(prompt("verifier")).toContain("Judging test quality or coverage is test-reviewer's task")
    for (const spec of SPECIALISTS) expect(prompt(spec.name)).toContain("End your answer after **Sources**")
    expect(prompt("test-writer")).toContain("from the specification")
    expect(prompt("debugger")).toContain("git bisect run")
    expect(prompt("ui-tester")).toContain("accessibility snapshot")
    expect(prompt("security-reviewer")).toContain("source: tool | llm")
    expect(prompt("dependency-check")).toContain("osv.dev")
    expect(prompt("api-lookup")).toContain("degraded")
  })

  test("the orchestrator's delegation table advertises every specialist with its requirement", async () => {
    // given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set(["anthropic/claude-opus-4-8", "openai/gpt-5.6-sol"]))

    try {
      // when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

      // then
      for (const spec of SPECIALISTS) {
        expect(agents[spec.name]?.mode).toBe("subagent")
        expect(agents.sisyphus?.prompt).toContain(`→ \`${spec.name}\``)
      }
      expect(agents.sisyphus?.prompt).toContain("→ `verifier` - ")
      expect(agents.sisyphus?.prompt).toContain("**MANDATORY before claiming any task done")
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
