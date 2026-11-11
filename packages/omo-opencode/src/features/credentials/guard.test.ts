/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCredentialsGuard } from "./guard"
import { secretEnvName } from "./inject"
import { createCredentialStore } from "./store"

let dir = ""
let staged = ""
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omo-credentials-guard-"))
  staged = ""
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function guard() {
  const store = createCredentialStore(dir)
  return { store, guard: createCredentialsGuard({ directory: dir, store, stagedDiff: () => staged }) }
}

async function blocked(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (error) {
    return (error as Error).message
  }
  return ""
}

describe("passwords the agent sets are saved and then hidden", () => {
  test("a password set in a command is saved and the agent is told how to reuse it", async () => {
    const { store, guard: g } = guard()
    const output = { output: "CREATE ROLE" }
    await g.after({ tool: "bash", sessionID: "s", callID: "c1", args: { command: "psql -c \"CREATE USER app WITH PASSWORD 'app-pass-1'\"" } }, output)
    expect(store.get("postgres-user-app")?.value).toBe("app-pass-1")
    expect(output.output).toContain("${OMO_SECRET:postgres-user-app}")
  })

  test("a .env the agent writes is captured with its file and line", async () => {
    const { store, guard: g } = guard()
    writeFileSync(join(dir, ".env"), "APP=x\nDB_PASSWORD=env-pass-22\n")
    await g.after({ tool: "write", sessionID: "s", callID: "c2", args: { filePath: join(dir, ".env"), content: "" } }, { output: "Wrote file" })
    expect(store.get("DB_PASSWORD")?.origin).toBe(".env:2")
  })

  test("a saved value is blanked in any tool's output", async () => {
    const { store, guard: g } = guard()
    store.save({ name: "db", kind: "generic", value: "hunter2-long", origin: "x" })
    const output = { output: "DB_PASSWORD=hunter2-long" }
    await g.after({ tool: "read", sessionID: "s", callID: "c3", args: {} }, output)
    expect(output.output).toBe("DB_PASSWORD=[secret:db]")
  })
})

describe("${OMO_SECRET:name} in a command", () => {
  test("the command is rewritten and the value goes through shell.env for that call only", async () => {
    const { store, guard: g } = guard()
    store.save({ name: "db", kind: "generic", value: "hunter2-long", origin: "x" })
    const args: Record<string, unknown> = { command: "psql \"postgres://app:${OMO_SECRET:db}@localhost/app\"" }
    await g.before("bash", "s", "c4", args)
    expect(String(args["command"])).not.toContain("hunter2")
    expect(g.shellEnv("c4")).toEqual({ [secretEnvName("db")]: "hunter2-long" })
    expect(g.shellEnv("c4")).toEqual({})
  })

  test("an unknown name is refused before running, with the saved names", async () => {
    const { store, guard: g } = guard()
    store.save({ name: "db", kind: "generic", value: "hunter2-long", origin: "x" })
    expect(await blocked(g.before("bash", "s", "c5", { command: "echo ${OMO_SECRET:nope}" }))).toContain("Saved: db")
  })
})

describe("saved passwords never reach git", () => {
  test("force-adding the store is refused", async () => {
    const { guard: g } = guard()
    expect(await blocked(g.before("bash", "s", "c6", { command: "git add -f .omo/secrets/credentials.json" }))).toContain("[credentials]")
  })

  test("a commit whose staged changes contain a saved value is refused, naming the credential", async () => {
    const { store, guard: g } = guard()
    store.save({ name: "db", kind: "generic", value: "hunter2-long", origin: "x" })
    staged = "+++ b/config/app.ts\n+const password = 'hunter2-long'\n"
    const message = await blocked(g.before("bash", "s", "c7", { command: "git commit -m 'config'" }))
    expect(message).toContain("db")
    expect(message).toContain("config/app.ts")
  })

  test("a clean commit goes through", async () => {
    const { store, guard: g } = guard()
    store.save({ name: "db", kind: "generic", value: "hunter2-long", origin: "x" })
    staged = "+++ b/src/a.ts\n+const x = 1\n"
    expect(await blocked(g.before("bash", "s", "c8", { command: "git -C . commit -am 'x'" }))).toBe("")
  })

  test("a .gitignore is not needed: the store ignores itself", () => {
    const { store } = guard()
    store.save({ name: "db", kind: "generic", value: "hunter2-long", origin: "x" })
    mkdirSync(join(dir, "sub"), { recursive: true })
    expect(require("node:fs").readFileSync(join(dir, ".omo/secrets/.gitignore"), "utf8")).toBe("*\n")
  })
})
