/**
 * Forwards a request from a local QA/bench proxy to the real provider (QA 14-10-2026). Bun's fetch decodes a
 * compressed body but keeps the upstream content-encoding header; passing that response on made OpenCode decode it
 * a second time (BrotliDecompressionError) and the task died. The upstream is asked for an uncompressed answer, and
 * the encoding and length headers are dropped from whatever comes back, since the body passed on is decoded.
 */
export type RelayInit = {
  readonly method: string
  readonly headers: Headers
  readonly body?: BodyInit
  /** What the upstream may send; only tests change it, to force a compressed answer. */
  readonly forceUpstreamEncoding?: string
}

export async function relayUpstream(url: string, init: RelayInit): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.delete("host")
  headers.delete("content-length")
  headers.set("accept-encoding", init.forceUpstreamEncoding ?? "identity")
  const upstream = await fetch(url, { method: init.method, headers, ...(init.body === undefined ? {} : { body: init.body }) })
  const passed = new Headers(upstream.headers)
  passed.delete("content-encoding")
  passed.delete("content-length")
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: passed })
}
