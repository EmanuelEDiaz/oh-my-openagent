/**
 * Forwards a request from a local QA/bench proxy to the real provider (QA 14-10-2026).
 * - The request goes out exactly as OpenCode sent it (minus host and length): Zen refuses free-tier requests that
 *   do not look like OpenCode's ("free tier can only be used from within OpenCode"), so even accept-encoding stays.
 * - Bun's fetch decodes a compressed answer but keeps the upstream content-encoding header; passing that on made
 *   OpenCode decode it again (BrotliDecompressionError). The encoding and length headers are dropped, since the
 *   body passed on is the decoded one.
 */
export type RelayInit = {
  readonly method: string
  readonly headers: Headers
  readonly body?: BodyInit
}

export async function relayUpstream(url: string, init: RelayInit): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.delete("host")
  headers.delete("content-length")
  const upstream = await fetch(url, { method: init.method, headers, ...(init.body === undefined ? {} : { body: init.body }) })
  const passed = new Headers(upstream.headers)
  passed.delete("content-encoding")
  passed.delete("content-length")
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: passed })
}
