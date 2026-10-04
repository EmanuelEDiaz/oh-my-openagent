/**
 * Error and fix fingerprints for the loop breaker (fork roadmap 0.9b). The same failure must hash the same across runs,
 * so paths, line/column numbers, addresses, dates, durations and counters are removed before hashing.
 */
import { createHash } from "node:crypto"

export type ErrorFingerprint = { readonly key: string; readonly summary: string }

const NOISE: ReadonlyArray<[RegExp, string]> = [
  [/\x1b\[[0-9;]*m/g, ""],
  [/(?:[A-Za-z]:)?(?:[\\/][\w@.+-]+)+\.\w+/g, "<path>"],
  [/(?:[A-Za-z]:)?(?:[\\/][\w@.+-]+){2,}/g, "<path>"],
  [/:\d+(?::\d+)?\b/g, ":<n>"],
  [/\bline \d+\b/gi, "line <n>"],
  [/\b0x[0-9a-f]+\b/gi, "<addr>"],
  [/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?\b/g, "<date>"],
  [/\b\d+(?:\.\d+)?\s?(?:ms|s|m)\b/g, "<time>"],
  [/\[\d+(?:\.\d+)?ms\]/g, "[<time>]"],
  [/\b(?:pid|port)\s*[=:]?\s*\d+\b/gi, "<id>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hash>"],
  [/\b\d+ (?:pass|fail|tests?|expect\(\) calls?|errors?|warnings?)\b/gi, "<count>"],
]

export function normalise(text: string): string {
  let out = text
  for (const [pattern, replacement] of NOISE) out = out.replace(pattern, replacement)
  return out.replace(/\s+/g, " ").trim()
}

const ERROR_LINE = /(?:\w*(?:Error|Exception)\b[:\s]|\berror\b[\s:[]|\bTS\d{4}\b|\bE\d{3,4}\b|panic:|\bFAIL(?:ED)?\b|AssertionError|Traceback|\bcannot\b|\bundefined\b.*\bnot\b|expect\(received\))/i
const TEST_FAILURE = /^\s*(?:\(fail\)|✗|×|✕|FAIL|--- FAIL:|FAILED)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/

/** The lines that identify a failure: failing test names plus the first assertion/error message lines. */
export function keyLines(output: string): string[] {
  const lines = output.split(/\r?\n/)
  const tests = lines.map((line) => TEST_FAILURE.exec(line)?.[1]?.trim()).filter((name): name is string => !!name)
  const errors = lines.filter((line) => ERROR_LINE.test(line)).map((line) => line.trim()).filter((line) => line.length > 3)
  const picked = [...new Set([...tests.map((name) => `test: ${name}`), ...errors])].slice(0, 6)
  return picked.length > 0 ? picked : lines.map((line) => line.trim()).filter(Boolean).slice(-3)
}

export function fingerprintError(output: string): ErrorFingerprint | undefined {
  const lines = keyLines(output)
  if (lines.length === 0) return undefined
  const normalised = lines.map(normalise).filter(Boolean)
  if (normalised.length === 0) return undefined
  const key = createHash("sha256").update(normalised.join("\n")).digest("hex").slice(0, 16)
  return { key, summary: lines.slice(0, 3).join(" | ").slice(0, 300) }
}

function tokens(text: string): Set<string> {
  return new Set(normalise(text).toLowerCase().match(/[\p{L}\p{N}_$.]+|[^\s\p{L}\p{N}]/gu) ?? [])
}

/** Jaccard similarity of two fixes' token sets; ≥ 0.9 counts as "almost the same fix". */
export function similarity(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 && right.size === 0) return 1
  let shared = 0
  for (const token of left) if (right.has(token)) shared++
  return shared / (left.size + right.size - shared)
}
