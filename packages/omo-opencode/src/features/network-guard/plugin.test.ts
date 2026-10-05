import { describe, expect, test } from "bun:test"

import { findIpBinary } from "./link-monitor"
import { probeUrl, providerBaseUrl } from "./plugin"

describe("network guard wiring (fork 0.15)", () => {
  test("any HTTP response counts as reachable; a transport failure does not", async () => {
    // given
    const seen: Array<{ url: string; method?: string }> = []
    const answers404 = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method })
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    const fails = (async () => { throw new TypeError("fetch failed") }) as unknown as typeof fetch

    // then
    expect(await probeUrl("https://api.example.test/v1", answers404)).toBe(true)
    expect(seen).toEqual([{ url: "https://api.example.test/v1", method: "HEAD" }])
    expect(await probeUrl("https://api.example.test/v1", fails)).toBe(false)
  })

  test("the provider URL comes from the user's baseURL, else the provider or model API URL", () => {
    expect(providerBaseUrl({ options: { baseURL: "https://proxy.local/v1" }, api: "https://api.x.test" })).toBe("https://proxy.local/v1")
    expect(providerBaseUrl({ options: {}, api: "https://api.x.test" })).toBe("https://api.x.test")
    expect(providerBaseUrl({ models: { m: { api: { url: "https://models.x.test" } } } })).toBe("https://models.x.test")
    expect(providerBaseUrl({ options: {} })).toBeUndefined()
    expect(providerBaseUrl(undefined)).toBeUndefined()
  })

  test("the link monitor is Linux-only and needs iproute2", () => {
    expect(findIpBinary("win32", () => true)).toBeUndefined()
    expect(findIpBinary("darwin", () => true)).toBeUndefined()
    expect(findIpBinary("linux", () => false)).toBeUndefined()
    expect(findIpBinary("linux", (path) => path === "/usr/bin/ip")).toBe("/usr/bin/ip")
  })
})
