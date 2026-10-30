/** Small keyed checksum so receivers can tell the payload came from us (djb2 over secret + body). */
export function signature(body: string, secret: string): string {
  let hash = 5381
  for (const char of `${secret}:${body}`) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0
  return hash.toString(16).padStart(8, "0")
}
