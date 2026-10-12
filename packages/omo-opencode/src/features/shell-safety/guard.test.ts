/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createShellSafetyGuard, commandFingerprint } from "./guard"

function guard() {
  return createShellSafetyGuard({
    directory: "/p",
    readFile: () => undefined,
    killContext: () => ({ protectedPids: new Set([1, 500]), protectedGroups: new Set([480]), ownedPids: new Set([900]), groupOf: () => undefined }),
    rootOf: async (sessionID) => sessionID.replace(/-child$/, ""),
  })
}

async function blocked(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (error) {
    return (error as Error).message
  }
  return ""
}

const bash = (g: ReturnType<typeof guard>, command: string, sessionID = "s") => g.before("bash", sessionID, { command })
const answer = (g: ReturnType<typeof guard>, text: string, sessionID = "s") =>
  g.after({ tool: "question", sessionID, args: {} }, { metadata: { answers: [[text]] } })
const ran = (g: ReturnType<typeof guard>, command: string, output: string, exit = 0, sessionID = "s") =>
  g.after({ tool: "bash", sessionID, args: { command } }, { output, metadata: { exit } })

const DROP = "docker exec db psql -U app -c 'DROP DATABASE shop'"

describe("kills", () => {
  test("a kill of OpenCode is refused; the agent's own process can be stopped", async () => {
    expect(await blocked(bash(guard(), "kill -9 500"))).toContain("Blocked")
    expect(await blocked(bash(guard(), "kill 900"))).toBe("")
  })
})

describe("destructive commands need the user's approval for that exact command", () => {
  test("refused with the option to offer", async () => {
    const message = await blocked(bash(guard(), DROP))
    expect(message).toContain("DROP DATABASE")
    expect(message).toContain(`"Allow destructive command #${commandFingerprint(DROP)}"`)
  })

  test("after the user allows it, that command runs, and the approval covers subagents of the same task", async () => {
    const g = guard()
    await answer(g, `Allow destructive command #${commandFingerprint(DROP)}`)
    expect(await blocked(bash(g, DROP))).toBe("")
    expect(await blocked(bash(g, DROP, "s-child"))).toBe("")
  })

  test("an approval does not cover a different command", async () => {
    const g = guard()
    await answer(g, `Allow destructive command #${commandFingerprint(DROP)}`)
    expect(await blocked(bash(g, "docker volume rm pgdata"))).toContain("Allow destructive command #")
  })

  test("clearly-test targets run without asking", async () => {
    expect(await blocked(bash(guard(), "dropdb shop_test"))).toBe("")
  })
})

describe("a failed password never leads to destroying the database", () => {
  test("after a password failure, destroying is refused with the four fixed options", async () => {
    const g = guard()
    await ran(g, "psql -U app shop -c 'select 1'", "psql: error: FATAL:  password authentication failed for user \"app\"", 2)
    const message = await blocked(bash(g, DROP))
    expect(message).toContain("password just failed")
    expect(message).toContain("Reuse the saved password")
    expect(message).toContain("Change the password without losing data")
    expect(message).toContain(`Destroy after a backup #${commandFingerprint(DROP)}`)
    expect(message).toContain("Cancel")
  })

  test("a plain approval is not enough after a password failure; a backup plus the backup option is", async () => {
    const g = guard()
    await ran(g, "mysql -u root shop", "ERROR 1045 (28000): Access denied for user 'root'@'localhost'", 1)
    await answer(g, `Allow destructive command #${commandFingerprint(DROP)}`)
    expect(await blocked(bash(g, DROP))).toContain("password just failed")
    await answer(g, `Destroy after a backup #${commandFingerprint(DROP)}`)
    expect(await blocked(bash(g, DROP))).toContain("back it up first")
    await ran(g, "docker exec db pg_dump -U postgres shop > shop.sql", "", 0)
    expect(await blocked(bash(g, DROP))).toBe("")
  })

  test("a failed backup does not count", async () => {
    const g = guard()
    await ran(g, "psql shop", "FATAL:  password authentication failed", 2)
    await answer(g, `Destroy after a backup #${commandFingerprint(DROP)}`)
    await ran(g, "pg_dump shop > shop.sql", "pg_dump: error: connection failed", 1)
    expect(await blocked(bash(g, DROP))).toContain("back it up first")
  })
})
