/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { pastAgentPrimaries, recordAgentPrimary } from "./agent-primary-history"

describe("agent primary history (resumed sessions after /omo-models)", () => {
  let cacheDir: string

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "omo-primary-history-"))
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  test("a recorded primary is read back by a later run, per agent and without the variant", () => {
    recordAgentPrimary("sisyphus", "opencode/ling-3.1-flash-free (high)", { cacheDir })
    recordAgentPrimary("oracle", "opencode/big-pickle", { cacheDir })
    expect(pastAgentPrimaries("sisyphus", { cacheDir })).toEqual(["opencode/ling-3.1-flash-free"])
    expect(pastAgentPrimaries("oracle", { cacheDir })).toEqual(["opencode/big-pickle"])
    expect(pastAgentPrimaries("atlas", { cacheDir })).toEqual([])
  })

  test("recording the same model again does not duplicate it and moves it to the end", () => {
    recordAgentPrimary("sisyphus", "opencode/a", { cacheDir })
    recordAgentPrimary("sisyphus", "opencode/b", { cacheDir })
    recordAgentPrimary("sisyphus", "opencode/a", { cacheDir })
    expect(pastAgentPrimaries("sisyphus", { cacheDir })).toEqual(["opencode/b", "opencode/a"])
  })

  test("only the last 20 primaries per agent are kept", () => {
    for (let index = 0; index < 25; index++) recordAgentPrimary("sisyphus", `opencode/m${index}`, { cacheDir })
    const past = pastAgentPrimaries("sisyphus", { cacheDir })
    expect(past).toHaveLength(20)
    expect(past[0]).toBe("opencode/m5")
    expect(past.at(-1)).toBe("opencode/m24")
  })

  test("a corrupt file is ignored and replaced on the next record", () => {
    writeFileSync(join(cacheDir, "agent-primary-history.json"), "{not json")
    expect(pastAgentPrimaries("sisyphus", { cacheDir })).toEqual([])
    recordAgentPrimary("sisyphus", "opencode/a", { cacheDir })
    expect(JSON.parse(readFileSync(join(cacheDir, "agent-primary-history.json"), "utf-8"))).toEqual({ agents: { sisyphus: ["opencode/a"] } })
  })

  test("a string that is not a model id is never recorded", () => {
    recordAgentPrimary("sisyphus", "not-a-model", { cacheDir })
    expect(pastAgentPrimaries("sisyphus", { cacheDir })).toEqual([])
  })
})
