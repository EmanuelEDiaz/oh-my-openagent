/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCredentialStore } from "../../features/credentials/store"
import { createCredentialTools } from "./tools"

let dir = ""
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omo-credential-tool-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const call = (args: Record<string, unknown>) => createCredentialTools(createCredentialStore(dir)).credential!.execute(args as never, { sessionID: "s" } as never)

describe("credential tool (0.21, entrega 2)", () => {
  test("save, then get returns the reference to use, not the value", async () => {
    expect(await call({ action: "save", name: "db", value: "s3cret-db", user: "app" })).toContain("${OMO_SECRET:db}")
    const got = String(await call({ action: "get", name: "db" }))
    expect(got).toContain("${OMO_SECRET:db}")
    expect(got).toContain("user app")
    expect(got).not.toContain("s3cret-db")
  })

  test("reveal shows the value only when asked", async () => {
    await call({ action: "save", name: "db", value: "s3cret-db" })
    expect(String(await call({ action: "get", name: "db", reveal: true }))).toContain("s3cret-db")
  })

  test("list shows names and where each came from, never values", async () => {
    await call({ action: "save", name: "db", value: "s3cret-db" })
    const listed = String(await call({ action: "list" }))
    expect(listed).toContain("db")
    expect(listed).not.toContain("s3cret-db")
  })

  test("an unknown name says what exists", async () => {
    await call({ action: "save", name: "db", value: "s3cret-db" })
    expect(String(await call({ action: "get", name: "other" }))).toContain("Saved: db")
  })

  test("the description stays short (it is sent with every request)", () => {
    expect(createCredentialTools(createCredentialStore(dir)).credential!.description.length).toBeLessThan(400)
  })
})
