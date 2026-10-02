import { describe, expect, test } from "bun:test"

import { shellArgv } from "./shell"

describe("shellArgv (fork 0.8b)", () => {
  test("POSIX runs through bash -c when available, else sh -c", () => {
    expect(shellArgv("npm i && npm test | tee x", { platform: "linux", bash: "/usr/bin/bash" })).toEqual(["/usr/bin/bash", "-c", "npm i && npm test | tee x"])
    expect(shellArgv("ls", { platform: "linux", bash: null })).toEqual(["/bin/sh", "-c", "ls"])
  })

  test("Windows prefers Git Bash and falls back to cmd", () => {
    expect(shellArgv("npm test", { platform: "win32", bash: "C:\\Program Files\\Git\\bin\\bash.exe" })).toEqual(["C:\\Program Files\\Git\\bin\\bash.exe", "-c", "npm test"])
    expect(shellArgv("npm test", { platform: "win32", bash: null, comspec: "C:\\Windows\\system32\\cmd.exe" })).toEqual(["C:\\Windows\\system32\\cmd.exe", "/d", "/s", "/c", "npm test"])
  })
})
