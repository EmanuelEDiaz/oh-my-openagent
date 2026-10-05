import { afterEach, describe, expect, test } from "bun:test"

import { setNetworkGuard, setNetworkResilienceEnabled, stepAsideForNetwork } from "./index"
import { findIpBinary } from "./link-monitor"
import { createPluginNetworkGuard, networkFingerprint, probeUrl, providerBaseUrl } from "./plugin"

afterEach(() => {
  setNetworkGuard(undefined)
  setNetworkResilienceEnabled(true)
})

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

  test("the session's own model API URL wins over the provider's", () => {
    const provider = { api: "https://api.x.test", models: { a: { api: { url: "https://a.x.test" } }, b: { api: { url: "https://b.x.test" } } } }
    expect(providerBaseUrl(provider, "b")).toBe("https://b.x.test")
    expect(providerBaseUrl(provider, "missing")).toBe("https://api.x.test")
  })

  test("resilience disabled is applied even when the rest of the config is invalid", () => {
    // given
    setNetworkResilienceEnabled(true)
    const config = { resilience: { enabled: false, network_probe_limit: "many" } } as never

    // when
    expect(() => createPluginNetworkGuard({} as never, config)).toThrow()

    // then: the fallback paths keep network errors
    expect(stepAsideForNetwork("ses", "fetch failed", true)).toBe(false)
  })

  test("the address fingerprint ignores loopback and does not depend on order", () => {
    const entry = (address: string, internal = false) => ({ address, internal, family: "IPv4", netmask: "", mac: "", cidr: null }) as never
    const a = networkFingerprint({ lo: [entry("127.0.0.1", true)], wlan0: [entry("192.168.1.5")], eth0: [entry("10.0.0.2")] })
    const b = networkFingerprint({ eth0: [entry("10.0.0.2")], wlan0: [entry("192.168.1.5")] })
    expect(a).toBe(b)
    expect(networkFingerprint({ wlan0: [entry("192.168.1.6")] })).not.toBe(a)
  })

  test("the link monitor is Linux-only and needs iproute2", () => {
    expect(findIpBinary("win32", () => true)).toBeUndefined()
    expect(findIpBinary("darwin", () => true)).toBeUndefined()
    expect(findIpBinary("linux", () => false)).toBeUndefined()
    expect(findIpBinary("linux", (path) => path === "/usr/bin/ip")).toBe("/usr/bin/ip")
  })
})
