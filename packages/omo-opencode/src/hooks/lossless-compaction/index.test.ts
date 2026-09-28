/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ContextCollector } from "../../features/context-injector"
import { createOpencodeDbFixture } from "../../features/knowledge/session-fixture.test-support"
import type { FixtureMessage } from "../../features/knowledge/session-fixture.test-support"
import { createLosslessCompactionHook } from "./index"

const NOW = Date.parse("2026-09-28T12:00:00Z")
const SESSION = "ses_Lossless01"

function user(index: number, text: string, synthetic = false): FixtureMessage {
  return { id: `msg_${index}`, role: "user", created: NOW + index * 1000, parts: [{ id: `prt_${index}`, type: "text", text, synthetic }] }
}

describe("lossless-compaction hook", () => {
  let dir: string
  let project: string
  let registered: { sessionID: string; content: string }[]
  const collector = { register: (sessionID: string, entry: { content: string }) => { registered.push({ sessionID, content: entry.content }) } } as unknown as ContextCollector

  async function seed(summary?: string): Promise<void> {
    const messages: FixtureMessage[] = [
      user(1, "Never use lodash in this project."),
      user(2, "<system-reminder>injected by a hook</system-reminder>"),
      user(3, "Todo continuation", true),
      { id: "msg_4", role: "assistant", created: NOW + 4000, parts: [
        { id: "prt_4a", type: "tool", tool: "edit", input: { filePath: join(project, "src", "cache.ts") } },
        { id: "prt_4b", type: "tool", tool: "bash", input: { command: "bun test" }, error: "E_CACHE_TIMEOUT_42" },
        { id: "prt_4c", type: "text", text: "Done." },
      ] },
      user(5, "Add a retry with jitter to the cache client."),
      ...(summary ? [{ id: "msg_9", role: "assistant" as const, summary: true, created: NOW + 9000, parts: [{ id: "prt_9", type: "text" as const, text: summary }] }] : []),
    ]
    await createOpencodeDbFixture(join(dir, "opencode.db"), [
      { id: SESSION, projectId: "proj", directory: project, title: "t", updated: NOW, messages },
    ], [{ id: "proj", worktree: project }])
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omo-lossless-"))
    project = join(dir, "app")
    registered = []
    mkdirSync(join(project, "docs", "decisions"), { recursive: true })
    writeFileSync(join(project, "docs", "decisions", "D-20260928-1-use-valkey.md"),
      `---\nid: D-20260928-1\ntitle: "Use Valkey"\nstatus: active\ndate: 2026-09-28\nreversibility: costly\nsession: ${SESSION}/msg_1\nevidence:\n  - type: file\n    ref: "src/cache.ts:1"\n---\n# D-20260928-1: Use Valkey\n\n- **Decision:** Valkey over Redis because of the license\n`)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("asks the summarizer to keep the user's literal messages with locators, skipping injected and synthetic text", async () => {
    // given
    await seed()
    const hook = createLosslessCompactionHook({ directory: project }, { dbPath: join(dir, "opencode.db"), collector })

    // when
    await hook.capture(SESSION)
    const guidance = hook.inject(SESSION) ?? ""

    // then
    expect(guidance).toContain(`- [${SESSION}/msg_1/prt_1] Never use lodash in this project.`)
    expect(guidance).toContain(`- [${SESSION}/msg_5/prt_5] Add a retry with jitter to the cache client.`)
    expect(guidance).not.toContain("injected by a hook")
    expect(guidance).not.toContain("Todo continuation")
  })

  test("after compaction registers a state card with what the summary lost, decisions, files and errors", async () => {
    // given
    await seed("The user asked to add a retry with jitter to the cache client.")
    const hook = createLosslessCompactionHook({ directory: project }, { dbPath: join(dir, "opencode.db"), collector })
    await hook.capture(SESSION)

    // when
    await hook.event({ event: { type: "session.compacted", properties: { sessionID: SESSION } } })

    // then
    expect(registered).toHaveLength(1)
    const card = registered[0]!.content
    expect(registered[0]!.sessionID).toBe(SESSION)
    expect(card).toContain(`- "Never use lodash in this project." [${SESSION}/msg_1/prt_1]`)
    expect(card).not.toContain("\"Add a retry with jitter")
    expect(card).toContain("- D-20260928-1: Use Valkey — Valkey over Redis because of the license")
    expect(card).toContain("Files changed: src/cache.ts")
    expect(card).toContain(`- bash: E_CACHE_TIMEOUT_42 [${SESSION}/msg_4/prt_4b]`)
    expect(card).toContain("knowledge_open")
    expect(card.length).toBeLessThanOrEqual(4000)
  })

  test("ignores other events and missing databases without throwing", async () => {
    // given
    const hook = createLosslessCompactionHook({ directory: project }, { dbPath: join(dir, "missing.db"), collector })

    // when
    await hook.capture(SESSION)
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION } } })
    await hook.event({ event: { type: "session.compacted", properties: { sessionID: SESSION } } })

    // then
    expect(hook.inject(SESSION)).toBeUndefined()
    expect(registered).toEqual([])
  })
})
