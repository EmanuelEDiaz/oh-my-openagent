/** Edits that make a check pass without fixing anything (fork roadmap 0.9a; ImpossibleBench, arXiv 2510.20270). */
import { basename, extname } from "node:path"

import type { FileChange } from "./change"
import { isTestFile, moduleStemOf } from "./test-files"

export type Finding = { readonly rule: string; readonly detail: string; readonly line?: string }

const SKIP = [
  /\b(?:it|test|describe|context|suite)\.(?:skip|only|todo|skipIf|runIf)\b/,
  /\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/,
  /\bpytest\.(?:skip|xfail)\s*\(/,
  /@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b/,
  /\bt\.Skip(?:Now|f)?\s*\(/,
  /->markTestSkipped\s*\(|->markTestIncomplete\s*\(/,
  /->(?:skip|todo)\s*\(\s*\)?/,
  /#\[Ignore\]|@Disabled\b|@Ignore\b|\[Fact\(Skip\s*=|\[Ignore\]/,
]
const ANY_SKIP = new RegExp(SKIP.map((pattern) => pattern.source).join("|"))

const ASSERTION = /\bexpect\s*\(|\bassert(?:_\w+|\.\w+|That|Equals?|True|False|Same|Null|Count|Contains\w*)?\s*[(\s]|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\b|\$this->assert\w*\s*\(|\.should\b|\brequire\.\w+\s*\(/g
const STRONG_MATCHER = /\.(?:toBe|toEqual|toStrictEqual|toMatchObject|toThrow(?:Error)?\s*\(\s*\S|toHaveBeenCalledWith|toHaveLength|toContain|toMatch)\s*\(|assertEquals?\s*\(|assertSame\s*\(|assert\s+\S+\s*==/
const WEAK_MATCHER = /\.(?:toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined|toBeNull|toBeNaN|toBeInstanceOf|toHaveBeenCalled|toThrow)\s*\(\s*\)|expect\.anything\(\)|expect\.any\(|assert(?:True|NotNull|IsNotNone)?\s*\(\s*(?:True|true|1)\s*\)|assert\s+True\b|assert\s+\w+\s*$/
const SUPPRESSION = /@ts-ignore|@ts-expect-error|@ts-nocheck|#\s*type:\s*ignore|\/\/\s*nolint\b|#\s*noqa\b|@phpstan-ignore|@psalm-suppress|eslint-disable/
const LOOSE_ANY = /:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|:\s*Any\b|-> Any\b/
const MOCK_CALL = /\b(?:mock\.module|jest\.mock|vi\.mock|vi\.doMock|jest\.doMock)\s*\(\s*["'`]([^"'`]+)["'`]/

function count(pattern: RegExp, text: readonly string[]): number {
  let total = 0
  for (const line of text) total += line.match(new RegExp(pattern.source, "g"))?.length ?? 0
  return total
}

function firstMatch(pattern: RegExp, text: readonly string[]): string | undefined {
  return text.find((line) => pattern.test(line))?.trim()
}

/** Commented-out assertions do not count as assertions. */
function stripComments(line: string): string {
  return /^\s*(?:\/\/|#|\*|\/\*)/.test(line) ? "" : line
}

/** Blocking findings: these edits are refused for every agent. */
export function blockingFindings(change: FileChange): Finding[] {
  const findings: Finding[] = []
  const suppressionsAdded = count(SUPPRESSION, change.added) - count(SUPPRESSION, change.removed)
  if (suppressionsAdded > 0) {
    findings.push({ rule: "suppression", detail: "adds a type/lint suppression instead of fixing the error", line: firstMatch(SUPPRESSION, change.added) })
  }
  if (!isTestFile(change.path)) return findings

  const skipsAdded = count(ANY_SKIP, change.added) - count(ANY_SKIP, change.removed)
  if (skipsAdded > 0) {
    findings.push({ rule: "skip", detail: "skips or focuses tests (skip/only/xfail/todo)", line: SKIP.map((p) => firstMatch(p, change.added)).find(Boolean) })
  }
  const code = (text: readonly string[]) => text.map(stripComments)
  const assertionsLost = count(ASSERTION, code(change.removed)) - count(ASSERTION, code(change.added))
  if (change.kind === "delete" && count(ASSERTION, code(change.removed)) > 0) {
    findings.push({ rule: "assertions", detail: "deletes a test file with assertions" })
  } else if (assertionsLost > 0) {
    findings.push({ rule: "assertions", detail: `removes ${assertionsLost} assertion(s)`, line: change.removed.find((line) => new RegExp(ASSERTION.source).test(line))?.trim() })
  } else if (change.removed.some((line) => STRONG_MATCHER.test(line)) && change.added.some((line) => WEAK_MATCHER.test(line))
    && count(STRONG_MATCHER, change.added) < count(STRONG_MATCHER, change.removed)) {
    findings.push({ rule: "weakened", detail: "replaces an exact assertion with a weaker one", line: firstMatch(WEAK_MATCHER, change.added) })
  }
  const stem = moduleStemOf(change.path)
  if (stem) {
    for (const line of change.added) {
      const target = MOCK_CALL.exec(line)?.[1]
      if (target && basename(target, extname(target)) === stem) {
        findings.push({ rule: "self-mock", detail: `mocks the module under test (${target})`, line: line.trim() })
        break
      }
    }
  }
  return findings
}

/** Warnings: shown to the agent, never blocking. */
export function warningFindings(change: FileChange, testLiterals: (path: string) => readonly string[]): Finding[] {
  const findings: Finding[] = []
  const ext = extname(change.path)
  if ([".ts", ".tsx", ".mts", ".cts", ".py"].includes(ext) && count(LOOSE_ANY, change.added) > count(LOOSE_ANY, change.removed)) {
    findings.push({ rule: "any", detail: "adds an `any` type", line: firstMatch(LOOSE_ANY, change.added) })
  }
  if (isTestFile(change.path)) return findings
  const literals = new Set(testLiterals(change.path))
  if (literals.size === 0) return findings
  for (const line of change.added) {
    const compare = /(?:===?|!==?|\bis\b|\bin\b|case)\s*(["'`])([^"'`]{3,})\1|(["'`])([^"'`]{3,})\3\s*(?:===?|!==?)/.exec(line)
    const literal = compare?.[2] ?? compare?.[4]
    if (literal && literals.has(literal)) {
      findings.push({ rule: "test-literal", detail: `special-cases a value taken from the tests ("${literal}")`, line: line.trim() })
      break
    }
  }
  return findings
}

/** String literals in a test file, for the special-casing warning. */
export function stringLiterals(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/(["'`])([^"'`\n]{3,80})\1/g)) if (match[2]) found.add(match[2])
  return [...found]
}
