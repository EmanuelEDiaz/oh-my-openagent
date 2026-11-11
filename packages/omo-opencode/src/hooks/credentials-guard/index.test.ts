/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCredentialsGuardHook } from "./index"

// Fork roadmap 0.21, entrega 2, end to end on a real git repository.
let dir = ""
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omo-credentials-hook-"))
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: dir })
  git("init", "-q")
  writeFileSync(join(dir, "README.md"), "x\n")
  git("add", "-A")
  git("commit", "-qm", "init")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("credentials hook", () => {
  test("captured from a command, injected through shell.env, blanked in output, blocked in a commit", async () => {
    const hook = createCredentialsGuardHook({ client: {}, directory: dir } as never)
    const created = { output: "CREATE ROLE" } as { output: string }
    await hook["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c1", args: { command: "psql -c \"CREATE USER app WITH PASSWORD 'app-pass-77'\"" } }, created)
    expect(created.output).toContain("${OMO_SECRET:postgres-user-app}")

    const args: Record<string, unknown> = { command: "echo ${OMO_SECRET:postgres-user-app}" }
    await hook["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c2" }, { args })
    const env: Record<string, string> = {}
    await hook["shell.env"]({ callID: "c2" }, { env })
    const run = Bun.spawnSync(["bash", "-c", String(args["command"])], { env: { PATH: process.env.PATH ?? "", ...env } })
    expect(run.stdout.toString().trim()).toBe("app-pass-77")

    const shown = { output: "app-pass-77\n" }
    await hook["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c2", args }, shown)
    expect(shown.output).toBe("[secret:postgres-user-app]\n")

    writeFileSync(join(dir, "config.ts"), "export const password = 'app-pass-77'\n")
    Bun.spawnSync(["git", "add", "config.ts"], { cwd: dir })
    await expect(hook["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c3" }, { args: { command: "git commit -m config" } })).rejects.toThrow("postgres-user-app in config.ts")
  })
})
