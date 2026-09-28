/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { KnowledgeService } from "../../features/knowledge/service"
import { createKnowledgeIndexerHook } from "./index"

function fakeService(reasons: string[]): KnowledgeService {
  return {
    scheduleSync: (reason) => reasons.push(reason),
    syncNow: async () => undefined,
    search: async () => [],
    open: async () => "",
    close: () => undefined,
  }
}

describe("knowledge-indexer hook", () => {
  test("syncs at startup, on session.idle and after file-writing tools only", () => {
    // given
    const reasons: string[] = []
    const hook = createKnowledgeIndexerHook({ directory: "/project" }, undefined, fakeService(reasons))

    // when
    hook.event({ event: { type: "session.idle" } })
    hook.event({ event: { type: "message.updated" } })
    hook["tool.execute.after"]({ tool: "edit" })
    hook["tool.execute.after"]({ tool: "read" })

    // then
    expect(reasons).toEqual(["startup", "session.idle", "tool:edit"])
  })
})
