/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { KnowledgeService } from "../../features/knowledge/service"
import { createKnowledgeSearchTool } from "./tools"

function service(hits: Awaited<ReturnType<KnowledgeService["search"]>>): KnowledgeService {
  return { scheduleSync: () => undefined, syncNow: async () => undefined, search: async () => hits, close: () => undefined }
}

const context = {} as Parameters<ReturnType<typeof createKnowledgeSearchTool>["execute"]>[1]

describe("knowledge_search tool", () => {
  test("returns ranked hits with citable locators and the citation instruction", async () => {
    // given
    const search = createKnowledgeSearchTool(service([
      { kind: "decision", locator: "docs/decisions/D-1.md:5", title: "Cache", snippet: "Usamos «Redis»", updatedAt: Date.parse("2026-09-27"), score: 9 },
    ]))

    // when
    const output = await search.execute({ query: "redis" }, context)

    // then
    expect(output).toContain("1. [decision] docs/decisions/D-1.md:5 — Cache (2026-09-27)")
    expect(output).toContain("Cite the locator")
  })

  test("says explicitly when nothing matches instead of letting the model guess", async () => {
    // when
    const output = await createKnowledgeSearchTool(service([])).execute({ query: "kafka" }, context)

    // then
    expect(output).toContain("Do not assume")
  })
})
