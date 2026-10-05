import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig } from "../../config"
import { createChatMessageHandler } from "../../plugin/chat-message"
import type { PluginContext } from "../../plugin/types"
import { _resetForTesting } from "../background-agent/process-cleanup"
import { createPluginResilience, type PluginResilience } from "./plugin"
import { INTERRUPTED_WORK_TAG } from "./resume-note"
import { loadInterruption } from "./store"
import { readWipMarkers, writeWipMarker } from "./wip-marker"

const dirs: string[] = []
let active: PluginResilience | undefined
afterEach(() => {
  active?.tracker.shutdown()
  active = undefined
  _resetForTesting()
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

function deadPid(): number {
  return Bun.spawnSync(["true"]).pid
}

function context(directory: string) {
  const toasts: string[] = []
  const ctx = unsafeTestValue<PluginContext>({
    directory,
    client: {
      session: {
        messages: async () => ({ data: [{ info: { role: "assistant", id: "m1" }, parts: [{ type: "tool", callID: "c1", tool: "bash", state: { status: "completed", input: { command: "ls" } } }] }] }),
        get: async () => ({ data: { title: "Refactor auth" } }),
      },
      tui: { showToast: async (input: { body: { message: string } }) => { toasts.push(input.body.message) } },
    },
  })
  return { ctx, toasts }
}

describe("killed-process recovery wiring (fork 0.15 C/D)", () => {
  test("an orphaned marker becomes an interruption; the next message of any text carries the note once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-resilience-"))
    dirs.push(directory)
    writeWipMarker(directory, {
      pid: deadPid(),
      startedAt: 1,
      startSource: "plugin",
      heartbeat: Date.now(),
      sessions: [{ sessionID: "ses_main", openTools: [{ callID: "c2", tool: "bash", summary: "npm test" }], subtasks: [] }],
    })
    const { ctx } = context(directory)

    active = createPluginResilience(ctx, undefined)
    expect(active?.recovered).toHaveLength(1)
    expect(loadInterruption(directory, "ses_main")?.cause).toBe("killed")
    expect(readWipMarkers(directory)).toEqual([])

    const handler = createChatMessageHandler({
      ctx,
      pluginConfig: unsafeTestValue<OhMyOpenCodeConfig>({}),
      firstMessageVariantGate: { shouldOverride: () => false, markApplied: () => undefined },
      hooks: unsafeTestValue<Parameters<typeof createChatMessageHandler>[0]["hooks"]>({}),
    })
    const output = { message: {}, parts: [{ type: "text", text: "add a README section" }] }
    await handler({ sessionID: "ses_main" }, output)
    expect(output.parts[0]!.text).toStartWith("add a README section")
    expect(output.parts[0]!.text).toContain(INTERRUPTED_WORK_TAG)
    expect(output.parts[0]!.text).toContain("bash `npm test`: never re-run it blindly")

    active!.onEvent({ type: "message.updated", properties: { info: { sessionID: "ses_main", role: "user", id: "m2" } } })
    expect(loadInterruption(directory, "ses_main")).toBeUndefined()
    const next = { message: {}, parts: [{ type: "text", text: "continúa" }] }
    await handler({ sessionID: "ses_main" }, next)
    expect(next.parts[0]!.text).not.toContain(INTERRUPTED_WORK_TAG)
  })

  test("resilience.enabled false wires nothing", () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-resilience-"))
    dirs.push(directory)
    expect(createPluginResilience(context(directory).ctx, { enabled: false })).toBeUndefined()
  })
})
