/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCredentialStore } from "./store"

let dir = ""
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omo-credentials-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const entry = (value: string) => ({ name: "postgres-user-app", kind: "postgres" as const, user: "app", value, origin: "docker-compose.yml:12", session: "s1" })

describe("test credential store (0.21, entrega 2)", () => {
  test("saved under .omo/secrets with private permissions and ignoring itself in git", () => {
    const store = createCredentialStore(dir)
    store.save(entry("s3cret-app"))
    const file = join(dir, ".omo/secrets/credentials.json")
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, ".omo/secrets")).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(dir, ".omo/secrets/.gitignore"), "utf8")).toBe("*\n")
  })

  test("read back by a later process; the old value is kept when it changes", () => {
    createCredentialStore(dir).save(entry("first-pass"))
    const store = createCredentialStore(dir)
    store.save(entry("second-pass"))
    const saved = store.get("postgres-user-app")
    expect(saved?.value).toBe("second-pass")
    expect(saved?.history.map((old) => old.value)).toEqual(["first-pass"])
  })

  test("saving the same value again changes nothing", () => {
    const store = createCredentialStore(dir)
    expect(store.save(entry("same-pass"))).toBe("saved")
    expect(store.save(entry("same-pass"))).toBe("unchanged")
    expect(store.get("postgres-user-app")?.history).toEqual([])
  })

  test("the list never shows values", () => {
    const store = createCredentialStore(dir)
    store.save(entry("hidden-value"))
    expect(JSON.stringify(store.list())).not.toContain("hidden-value")
    expect(store.list()[0]).toMatchObject({ name: "postgres-user-app", user: "app", origin: "docker-compose.yml:12" })
  })

  test("values to redact: current and old ones, long enough not to hit ordinary text", () => {
    const store = createCredentialStore(dir)
    store.save(entry("first-pass"))
    store.save(entry("second-pass"))
    store.save({ ...entry("1234"), name: "short" })
    expect(store.redactable().map((item) => item.value).sort()).toEqual(["first-pass", "second-pass"])
  })

  test("an unreadable file is not lost: it is moved aside and the store starts empty", () => {
    const store = createCredentialStore(dir)
    store.save(entry("keep-me"))
    require("node:fs").writeFileSync(join(dir, ".omo/secrets/credentials.json"), "{broken")
    const fresh = createCredentialStore(dir)
    expect(fresh.list()).toEqual([])
    expect(require("node:fs").readdirSync(join(dir, ".omo/secrets")).some((name: string) => name.startsWith("credentials.json.unreadable-"))).toBe(true)
  })
})
