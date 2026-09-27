/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createExternalDataStore } from "./external-data"

describe("createExternalDataStore", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omo-model-insights-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("fetches once, then serves the 24h cache; Artificial Analysis only with a key", async () => {
    // given
    const urls: string[] = []
    const fetchJson = async (url: string, headers?: Readonly<Record<string, string>>): Promise<unknown> => {
      urls.push(`${url}${headers?.["x-api-key"] ? " [key]" : ""}`)
      return url.includes("openrouter") ? { data: [{ id: "a/b", description: "B" }] } : { data: [{ slug: "b", evaluations: { artificial_analysis_coding_index: 40 } }] }
    }
    const cachePath = join(dir, "model-insights.json")
    let now = Date.parse("2026-09-27T00:00:00Z")

    // when
    const first = await createExternalDataStore({ fetchJson, cachePath, now: () => now }).load()
    const cached = await createExternalDataStore({ fetchJson, cachePath, now: () => now }).load()
    now += 25 * 60 * 60 * 1000
    await createExternalDataStore({ fetchJson, cachePath, now: () => now, artificialAnalysisKey: "k" }).load()

    // then
    expect(first.openRouter["a/b"]?.description).toBe("B")
    expect(cached).toEqual(first)
    expect(urls).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/models",
      "https://artificialanalysis.ai/api/v2/language/models/free [key]",
    ])
  })

  test("network failures degrade to empty data instead of throwing", async () => {
    // when
    const data = await createExternalDataStore({
      cachePath: join(dir, "x.json"),
      fetchJson: async () => {
        throw new Error("offline")
      },
    }).load()

    // then
    expect(data.openRouter).toEqual({})
    expect(data.benchmarks).toEqual({})
  })
})
