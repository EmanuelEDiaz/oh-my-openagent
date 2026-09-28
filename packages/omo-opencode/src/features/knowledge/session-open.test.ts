/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createKnowledgeService } from "./service"
import { createOpencodeDbFixture } from "./session-fixture.test-support"
import type { FixtureMessage } from "./session-fixture.test-support"
import { openKnowledgeStore } from "./store"

const NOW = Date.parse("2026-09-28T12:00:00Z")

function message(index: number, role: "user" | "assistant", text: string, extra: FixtureMessage["parts"] = []): FixtureMessage {
  return { id: `msg_${index}`, role, created: NOW - 100_000 + index * 1000, parts: [...extra, { id: `prt_${index}`, type: "text", text }] }
}

describe("knowledge_open and combined search", () => {
  let dir: string
  let project: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "omo-knowledge-open-"))
    project = join(dir, "app")
    mkdirSync(join(project, "docs", "decisions"), { recursive: true })
    writeFileSync(join(project, "docs", "decisions", "D-1.md"), "# D-1 Cache\nDecided in ses_Pinned0001/msg_1/prt_1: use Valkey.\n")
    await createOpencodeDbFixture(join(dir, "opencode.db"), [
      {
        id: "ses_Main00001", projectId: "proj-a", directory: project, title: "Cache design", updated: NOW - 1000,
        messages: [
          message(1, "user", "¿Qué cache usamos?"),
          message(2, "assistant", "Propongo Redis por la latencia.", [{ id: "prt_2r", type: "reasoning", text: "compare redis vs valkey licensing" }]),
          message(3, "user", "Mejor Valkey, por la licencia."),
          message(4, "assistant", "De acuerdo: Valkey."),
        ],
      },
      {
        id: "ses_Other0001", projectId: "proj-b", directory: "/elsewhere", title: "Other project", updated: NOW - 1000,
        messages: [message(9, "user", "Valkey benchmark in another project")],
      },
    ], [{ id: "proj-a", worktree: project }, { id: "proj-b", worktree: "/elsewhere" }])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function service() {
    return createKnowledgeService(project, undefined, {
      opencodeDbPath: join(dir, "opencode.db"),
      openSessionStore: () => openKnowledgeStore(join(dir, "sessions-index.db")),
      now: () => NOW,
    })
  }

  test("finds what was said in chat, scoped to this project by default, with open/re-audit instructions", async () => {
    // given
    const knowledge = service()
    await knowledge.search("warmup")
    await Bun.sleep(50)

    // when
    const projectHits = await knowledge.search("valkey licencia")
    const allHits = await knowledge.search("valkey benchmark", { scope: "all" })

    // then
    expect(projectHits?.some((hit) => hit.locator === "ses_Main00001/msg_3/prt_3")).toBe(true)
    expect(projectHits?.some((hit) => hit.locator.startsWith("ses_Other0001"))).toBe(false)
    expect(allHits?.some((hit) => hit.locator.startsWith("ses_Other0001"))).toBe(true)
    knowledge.close()
  })

  test("opens the original messages around a citation, including the cited message's reasoning", async () => {
    // when
    const output = await service().open("ses_Main00001/msg_2/prt_2", 1)

    // then
    expect(output).toContain("Session: Cache design (ses_Main00001)")
    expect(output).toContain("Re-audit: opencode run --session ses_Main00001 --fork")
    expect(output).toContain("¿Qué cache usamos?")
    expect(output).toContain("Mejor Valkey, por la licencia.")
    expect(output).not.toContain("De acuerdo: Valkey.")
    expect(output).toContain("[reasoning] compare redis vs valkey licensing")
    expect(output).toContain("Propongo Redis por la latencia.   ◀ cited prt_2")
  })

  test("explains bad or stale locators instead of guessing", async () => {
    // then
    expect(await service().open("plans/a.md:3")).toContain("Not a session locator")
    expect(await service().open("ses_Gone00001/msg_1")).toContain("no longer exists")
  })
})
