import { afterAll, describe, expect, test } from "bun:test"
import { brotliCompressSync } from "node:zlib"

import { relayUpstream } from "./proxy-relay"

// QA 14-10-2026: Zen answered brotli-compressed; Bun's fetch decodes the body but kept content-encoding: br, so
// OpenCode decoded it a second time and failed with BrotliDecompressionError.
const upstream = Bun.serve({
  port: 0,
  fetch: (request) => {
    const asked = request.headers.get("accept-encoding") ?? ""
    const body = JSON.stringify({ ok: true, asked })
    if (asked.includes("identity") && !asked.includes("br")) return new Response(body, { headers: { "content-type": "application/json" } })
    return new Response(brotliCompressSync(body), { headers: { "content-type": "application/json", "content-encoding": "br" } })
  },
})
afterAll(() => upstream.stop(true))

describe("relayUpstream", () => {
  test("asks the upstream for an uncompressed answer", async () => {
    const response = await relayUpstream(`http://127.0.0.1:${upstream.port}/x`, { method: "GET", headers: new Headers({ "accept-encoding": "gzip, br" }) })
    expect(((await response.json()) as { asked: string }).asked).toBe("identity")
  })

  test("a compressed answer is passed on decoded, without a content-encoding the client would decode again", async () => {
    const proxy = Bun.serve({ port: 0, fetch: () => relayUpstream(`http://127.0.0.1:${upstream.port}/x`, { method: "GET", headers: new Headers({ "accept-encoding": "br" }), forceUpstreamEncoding: "br" }) })
    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/`)
      expect(response.headers.get("content-encoding")).toBeNull()
      expect(((await response.json()) as { ok: boolean }).ok).toBe(true)
    } finally {
      proxy.stop(true)
    }
  })
})
