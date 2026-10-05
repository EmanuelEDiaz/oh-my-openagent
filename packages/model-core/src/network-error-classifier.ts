/**
 * Network-cut classifier (fork roadmap 0.15): tells "our connection dropped" (wait and resume on the same model) from
 * a model or provider failure (fall back). An error that carries an HTTP status code had a server answer, so a
 * 429/5xx is never a network cut.
 */

const NETWORK_ERROR_PATTERNS: readonly RegExp[] = [
  // Node / libc socket and DNS codes
  /\becon(?:nreset|nrefused|naborted)\b/i,
  /\benotfound\b/i,
  /\beai_again\b/i,
  /\betimedout\b/i,
  /\be(?:net|host)unreach\b/i,
  /\benetdown\b/i,
  /\bepipe\b/i,
  /getaddrinfo/i,
  // undici (Node fetch)
  /fetch failed/i,
  /socket hang up/i,
  /other side closed/i,
  /\bund_err_(?:socket|connect_timeout|headers_timeout)\b/i,
  // TLS record corrupted by a dropped link
  /\berr_ssl_[a-z0-9_]*bad_record_mac\b/i,
  // Bun fetch
  /\bconnectionrefused\b/i,
  /\bfailedtoopensocket\b/i,
  /\bconnectionclosed\b/i,
  /unable to connect/i,
  /socket connection was closed/i,
  // SDK / OpenCode wording
  /connection (?:closed|refused|reset|error)/i,
  /network(?:\s|_)?error/i,
  /network is unreachable/i,
]

/**
 * Retryable-without-status errors whose text shows a server answered (pressure, quota, gateway, an error body, a
 * status in the text): provider failures for the fallback path, not network cuts.
 */
const SERVER_ANSWER_PATTERNS: readonly RegExp[] = [
  /\b[45]\d\d\b/,
  /gateway/i,
  /server error/i,
  /internal error/i,
  /not found/i,
  /unknown provider/i,
  /\bmodel\b/i,
  /\{\s*"(?:error|type|message|detail)"/i,
  /overload/i,
  /rate.?limit/i,
  /too many requests/i,
  /quota/i,
  /capacity/i,
  /insufficient/i,
  /credit/i,
  /billing/i,
  /unavailable/i,
]

const MAX_DEPTH = 4

type Collected = { texts: string[]; statusCode?: number; retryable?: boolean }

function read(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    // Hostile Proxy traps must not escape the classifier.
    return undefined
  }
}

function isStatusCode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
}

function collect(value: unknown, into: Collected, depth: number, seen: Set<unknown>): void {
  if (depth > MAX_DEPTH || value === undefined || value === null) return
  if (typeof value === "string") {
    into.texts.push(value)
    return
  }
  if (typeof value !== "object" || seen.has(value)) return
  seen.add(value)

  for (const key of ["name", "message", "code", "errno", "syscall"]) {
    const text = read(value, key)
    if (typeof text === "string" && text.length > 0) into.texts.push(text)
  }
  for (const key of ["statusCode", "status"]) {
    const code = read(value, key)
    if (into.statusCode === undefined && isStatusCode(code)) into.statusCode = code
  }
  const retryable = read(value, "isRetryable")
  if (typeof retryable === "boolean" && into.retryable === undefined) into.retryable = retryable

  for (const key of ["data", "error", "cause"]) {
    collect(read(value, key), into, depth + 1, seen)
  }
}

/**
 * True when the error is a lost connection (DNS, refused/reset socket, dead TLS record, fetch transport failure) or
 * an `APIError` marked retryable without any HTTP status. A response with a status code (429, 5xx, 4xx) is false.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  const collected: Collected = { texts: [] }
  collect(error, collected, 0, new Set())
  if (collected.statusCode !== undefined) return false

  const text = collected.texts.join("\n")
  if (NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(text))) return true

  return collected.retryable === true && !SERVER_ANSWER_PATTERNS.some((pattern) => pattern.test(text))
}
