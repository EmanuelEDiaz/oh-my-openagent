import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { formatMemory, needsServerRestart, processMemory, scopeMemory } from "./memory"

const MB = 1024 * 1024

function fakeCgroup(files: Record<string, string>): { root: string; selfCgroup: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), "fake-cgroup-"))
  const scope = join(base, "sys", "user.slice", "omo-work-1.scope")
  mkdirSync(scope, { recursive: true })
  for (const [name, value] of Object.entries(files)) writeFileSync(join(scope, name), `${value}\n`)
  const selfCgroup = join(base, "self-cgroup")
  writeFileSync(selfCgroup, "0::/user.slice/omo-work-1.scope\n")
  return { root: join(base, "sys"), selfCgroup, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

describe("scopeMemory (fork incident H54)", () => {
  test("adds memory and swap of the run's own cgroup, against both caps", () => {
    const cgroup = fakeCgroup({ "memory.current": String(1200 * MB), "memory.swap.current": String(300 * MB), "memory.max": String(1500 * MB), "memory.swap.max": String(512 * MB) })
    expect(scopeMemory(cgroup.root, cgroup.selfCgroup)).toEqual({ usedMb: 1500, limitMb: 2012 })
    cgroup.cleanup()
  })

  test("has no limit when the cgroup is uncapped, and is undefined outside cgroup v2", () => {
    const cgroup = fakeCgroup({ "memory.current": String(800 * MB), "memory.max": "max" })
    expect(scopeMemory(cgroup.root, cgroup.selfCgroup)).toEqual({ usedMb: 800, limitMb: undefined })
    cgroup.cleanup()
    expect(scopeMemory("/nonexistent-cgroup", "/nonexistent-self")).toBeUndefined()
  })
})

describe("processMemory", () => {
  test("lists processes by resident memory, largest first", () => {
    const proc = mkdtempSync(join(tmpdir(), "fake-proc-"))
    const write = (pid: number, name: string, kb: number) => {
      mkdirSync(join(proc, String(pid)))
      writeFileSync(join(proc, String(pid), "status"), `Name:\t${name}\nVmRSS:\t ${kb} kB\n`)
    }
    write(10, "opencode", 700 * 1024)
    write(11, "tsserver", 400 * 1024)
    expect(processMemory([11, 10, 12], proc)).toEqual([{ pid: 10, name: "opencode", rssMb: 700 }, { pid: 11, name: "tsserver", rssMb: 400 }])
    rmSync(proc, { recursive: true, force: true })
  })
})

describe("needsServerRestart", () => {
  test("restarts when the server or the whole run gets close to its cap", () => {
    expect(needsServerRestart({ serverRssMb: 950, scope: undefined }, { serverRssLimitMb: 900 })).toBe(true)
    expect(needsServerRestart({ serverRssMb: 500, scope: { usedMb: 1450, limitMb: 2012 } }, { serverRssLimitMb: 900 })).toBe(true)
    expect(needsServerRestart({ serverRssMb: 500, scope: { usedMb: 1000, limitMb: 2012 } }, { serverRssLimitMb: 900 })).toBe(false)
    expect(needsServerRestart({ serverRssMb: 500, scope: { usedMb: 1450, limitMb: undefined } }, { serverRssLimitMb: 900 })).toBe(false)
  })
})

describe("formatMemory", () => {
  test("one line with the server, the run's total and the largest processes", () => {
    const line = formatMemory({ serverRssMb: 730, scope: { usedMb: 1400, limitMb: 2012 } }, [{ pid: 10, name: "opencode", rssMb: 730 }, { pid: 11, name: "tsserver", rssMb: 400 }])
    expect(line).toBe("server 730 MB; run 1400/2012 MB; opencode 730, tsserver 400")
  })
})
