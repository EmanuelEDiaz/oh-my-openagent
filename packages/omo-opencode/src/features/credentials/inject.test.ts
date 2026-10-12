/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { injectSecrets, redactSecrets, secretEnvName } from "./inject"

const lookup = (name: string) => ({ db: "p@ss 'word\"", api: "tok-123456" } as Record<string, string>)[name]

/** Runs the rewritten command in a real shell with the injected env, to prove the value arrives intact. */
function shellOutput(command: string): string {
  const injected = injectSecrets(command, lookup)
  const run = Bun.spawnSync(["bash", "-c", injected.command], { env: { PATH: process.env.PATH ?? "", ...injected.env }, stdout: "pipe" })
  return run.stdout.toString()
}

describe("${OMO_SECRET:name} reaches the command without appearing in it", () => {
  test("the command text never contains the value", () => {
    const injected = injectSecrets("psql \"postgresql://app:${OMO_SECRET:db}@localhost/app\"", lookup)
    expect(injected.command).not.toContain("p@ss")
    expect(injected.env).toEqual({ [secretEnvName("db")]: "p@ss 'word\"" })
  })

  test.each([
    ["unquoted", "printf '%s' ${OMO_SECRET:db}"],
    ["double quotes", "printf '%s' \"pw=${OMO_SECRET:db}\""],
    ["single quotes", "printf '%s' 'pw=${OMO_SECRET:db}'"],
  ])("the value arrives intact: %s", (_name, command) => {
    expect(shellOutput(command)).toEndWith("p@ss 'word\"")
  })

  test("an unknown name is reported, with nothing run", () => {
    expect(injectSecrets("echo ${OMO_SECRET:nope}", lookup).missing).toEqual(["nope"])
  })

  test("commands without placeholders are untouched", () => {
    expect(injectSecrets("ls -la", lookup)).toEqual({ command: "ls -la", env: {}, missing: [] })
  })
})

describe("saved values are blanked in what the model reads", () => {
  test("every occurrence, longest first", () => {
    const text = "connected with tok-123456 and tok-1234567"
    expect(redactSecrets(text, [{ name: "api", value: "tok-123456" }, { name: "api2", value: "tok-1234567" }])).toBe("connected with [secret:api] and [secret:api2]")
  })
})
