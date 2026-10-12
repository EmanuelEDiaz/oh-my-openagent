/**
 * Type escapes and swallowed errors an edit adds (fork roadmap 0.9c, approved 11-10-2026). Small models "fix" a type
 * error with `any` or a cast and "fix" a crash with an empty catch; both hide the bug. The whole file is compared
 * before and after the edit and only what grows counts, so code that was already there, or that just moves, is never
 * blamed. Strings and comments are blanked before matching, and catch blocks are found by counting braces.
 */
import { basename, extname } from "node:path"

import { isTestFile } from "../test-integrity/test-files"

export type TypeErrorFinding = {
  readonly rule: "type-escape" | "swallowed-error" | "rethrow-without-cause" | "annotation-removed" | "config-loosened"
  readonly detail: string
  /** What to write instead. */
  readonly fix: string
  readonly line?: string
}

type Lang = "ts" | "js" | "py" | "go" | "php" | "c-like"

const GENERATED = /(?:\.d\.[cm]?ts$|(?:^|[/\\])(?:generated|__generated__|vendor|node_modules|dist|build)[/\\]|\.pb\.go$|_pb2(?:_grpc)?\.py$|\.g\.dart$)/

function langOf(path: string): Lang | undefined {
  const ext = extname(path).toLowerCase()
  if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) return "ts"
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "js"
  if (ext === ".py") return "py"
  if (ext === ".go") return "go"
  if (ext === ".php") return "php"
  if ([".java", ".cs", ".kt", ".swift", ".dart"].includes(ext)) return "c-like"
  return undefined
}

/** A `/` that opens a regex literal (after an operator or keyword), not a division. */
function startsRegex(text: string, at: number): boolean {
  let i = at - 1
  while (i >= 0 && /[ \t]/.test(text[i] ?? "")) i--
  if (i < 0 || text[i] === "\n") return true
  if (/[(,=:[!&|?{};+\-*%<>~^]/.test(text[i] ?? "")) return true
  return /\b(?:return|typeof|case|in|of|new|delete|void|throw|yield|await)$/.test(text.slice(Math.max(0, i - 7), i + 1))
}

/**
 * Two views of the source with the same length and line breaks: `code` has strings and comments blanked, `noStrings`
 * keeps the comments (to read the reason written inside a catch block).
 */
function views(text: string, lang: Lang): { code: string; noStrings: string } {
  const code = text.split("")
  const noStrings = text.split("")
  const blank = (target: string[], from: number, to: number) => {
    for (let i = from; i < to; i++) if (target[i] !== "\n") target[i] = " "
  }
  const hashComments = lang === "py" || lang === "php"
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i, i + 3)
    if (lang === "py" && (rest === '"""' || rest === "'''")) {
      const end = text.indexOf(rest, i + 3)
      const stop = end === -1 ? text.length : end + 3
      blank(code, i, stop)
      blank(noStrings, i, stop)
      i = stop
      continue
    }
    const ch = text[i]
    const next = text[i + 1]
    if ((ch === "/" && next === "/" && lang !== "py") || (ch === "#" && hashComments)) {
      const end = text.indexOf("\n", i)
      const stop = end === -1 ? text.length : end
      blank(code, i, stop)
      i = stop
      continue
    }
    if (ch === "/" && next === "*" && lang !== "py") {
      const end = text.indexOf("*/", i + 2)
      const stop = end === -1 ? text.length : end + 2
      blank(code, i, stop)
      i = stop
      continue
    }
    if (ch === "/" && (lang === "ts" || lang === "js") && startsRegex(text, i)) {
      let j = i + 1
      let inClass = false
      while (j < text.length && text[j] !== "\n" && (inClass || text[j] !== "/")) {
        if (text[j] === "\\") j++
        else if (text[j] === "[") inClass = true
        else if (text[j] === "]") inClass = false
        j++
      }
      while (/[a-z]/i.test(text[j + 1] ?? "")) j++
      const stop = Math.min(j + 1, text.length)
      blank(code, i, stop)
      blank(noStrings, i, stop)
      i = stop
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++
        else if (text[j] === "\n" && ch !== "`") break
        j++
      }
      const stop = Math.min(j + 1, text.length)
      blank(code, i, stop)
      blank(noStrings, i, stop)
      i = stop
      continue
    }
    i++
  }
  return { code: code.join(""), noStrings: noStrings.join("") }
}

const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/g

/** A real reason, not "ignore" or a TODO: at least three words. */
function explains(comments: string): boolean {
  for (const comment of comments.match(COMMENT) ?? []) {
    const words = comment.replace(/^(?:\/\/|\/\*|#)|\*\/$/g, "").trim()
    if (/^(?:todo|fixme|xxx)\b/i.test(words)) continue
    if (words.split(/\s+/).filter((word) => /\w/.test(word)).length >= 3) return true
  }
  return false
}

function matchingClose(code: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === openChar) depth++
    else if (code[i] === closeChar && --depth === 0) return i
  }
  return -1
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1
  const end = text.indexOf("\n", index)
  return text.slice(start, end === -1 ? text.length : end).trim()
}

type Hit = { readonly line: string }

const EMPTY_RESULT = /^(?:return\s*(?:null|undefined|false|\[\s*\]|\{\s*\}|void\s+0)?\s*;?)?$/

/** catch (…) { … } blocks: swallowed ones and rethrows that drop the caught error. */
function catchBlocks(text: string, v: { code: string; noStrings: string }): { swallowed: Hit[]; noCause: Hit[] } {
  const swallowed: Hit[] = []
  const noCause: Hit[] = []
  for (const match of v.code.matchAll(/\bcatch\b/g)) {
    let i = (match.index ?? 0) + match[0].length
    while (/\s/.test(v.code[i] ?? "")) i++
    let param = ""
    if (v.code[i] === "(") {
      const close = matchingClose(v.code, i, "(", ")")
      if (close === -1) continue
      // `.catch(handler)` on a promise is a call, not a catch clause.
      if (v.code[(match.index ?? 0) - 1] === ".") continue
      param = v.code.slice(i + 1, close)
      i = close + 1
      while (/\s/.test(v.code[i] ?? "")) i++
    }
    if (v.code[i] !== "{") continue
    const close = matchingClose(v.code, i, "{", "}")
    if (close === -1) continue
    const body = v.code.slice(i + 1, close)
    const comments = v.noStrings.slice(i + 1, close)
    const where = { line: lineAt(text, match.index ?? 0) }
    if (EMPTY_RESULT.test(body.trim()) && !explains(comments)) swallowed.push(where)
    const name = /\$?[A-Za-z_][\w$]*/.exec(param.replace(/^[^$]*?(\$\w+)/, "$1"))?.[0]
    if (!name) continue
    for (const thrown of body.matchAll(/\bthrow\s+new\s+[\w$.]+\s*\(/g)) {
      const open = i + 1 + (thrown.index ?? 0) + thrown[0].length - 1
      const end = matchingClose(v.code, open, "(", ")")
      const args = end === -1 ? "" : v.code.slice(open, end)
      if (!/\bcause\b/.test(args) && !new RegExp(`\\b${name.replace("$", "\\$")}\\b`).test(args)) noCause.push(where)
    }
  }
  for (const match of v.code.matchAll(/\.catch\(\s*(?:\([^()]*\)|[\w$]+)\s*=>\s*(?:\{\s*\}|null|undefined|void\s+0|\[\s*\]|false)\s*\)/g)) {
    const start = match.index ?? 0
    if (!explains(v.noStrings.slice(start, start + match[0].length))) swallowed.push({ line: lineAt(text, start) })
  }
  return { swallowed, noCause }
}

function pythonSwallows(text: string, v: { noStrings: string }): Hit[] {
  const hits: Hit[] = []
  const lines = v.noStrings.split("\n")
  const original = text.split("\n")
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ""
    const header = /^(\s*)except\b[^:]*:(.*)$/.exec(line)
    if (!header) continue
    const indent = header[1]?.length ?? 0
    const body: string[] = []
    const inline = (header[2] ?? "").trim()
    if (inline && !inline.startsWith("#")) body.push(inline)
    let comments = inline.startsWith("#") ? inline : ""
    for (let next = index + 1; next < lines.length; next++) {
      const candidate = lines[next] ?? ""
      if (candidate.trim() === "") continue
      if ((/^\s*/.exec(candidate)?.[0].length ?? 0) <= indent) break
      body.push(candidate.trim())
    }
    for (const entry of body) {
      const hash = entry.indexOf("#")
      if (hash !== -1) comments += ` ${entry.slice(hash)}`
    }
    const code = body.map((entry) => entry.replace(/#.*$/, "").trim()).filter(Boolean)
    if (code.length > 0 && code.every((entry) => /^(?:pass|\.\.\.|return(?:\s+None)?|continue)$/.test(entry)) && !explains(comments)) {
      hits.push({ line: (original[index] ?? "").trim() })
    }
  }
  return hits
}

function goSwallows(text: string, v: { code: string; noStrings: string }): Hit[] {
  const hits: Hit[] = []
  for (const pattern of [/\b_\s*=\s*err\b/g, /\bif\s+err\s*!=\s*nil\s*\{\s*return\s+nil\s*\}/g]) {
    for (const match of v.code.matchAll(pattern)) {
      const start = match.index ?? 0
      const end = v.noStrings.indexOf("\n", start + match[0].length)
      if (!explains(v.noStrings.slice(start, end === -1 ? undefined : end))) hits.push({ line: lineAt(text, start) })
    }
  }
  return hits
}

const TYPE_ESCAPES: ReadonlyArray<{ pattern: RegExp; detail: string; fix: string }> = [
  {
    pattern: /(?:[:<,|&(]\s*|\bas\s+)any\b(?![\w$])|\bany\s*\[\]/g,
    detail: "adds `any`",
    fix: "use the real type, a generic, or `unknown` narrowed with a type guard; `satisfies` checks a literal without widening it",
  },
  {
    pattern: /\bas\s+unknown\s+as\b/g,
    detail: "adds a double assertion (`as unknown as X`)",
    fix: "validate the value (a type guard or a schema parse) instead of forcing its type",
  },
  {
    pattern: /[\w$)\]]!(?=[.[(),;\]}]|[ \t]*$)/gm,
    detail: "adds a non-null assertion (`x!`)",
    fix: "check for null/undefined and handle it (an early return, or a thrown error that says what was missing)",
  },
]

function hitsOf(pattern: RegExp, text: string, code: string): Hit[] {
  return [...code.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => ({ line: lineAt(text, match.index ?? 0) }))
}

/** Annotation count per declared function name (parameters + return type). */
function signatures(code: string): Map<string, number> {
  const result = new Map<string, number>()
  const add = (name: string | undefined, params: string, returns: string | undefined) => {
    if (!name) return
    const count = (params.match(/[\w$\]}]\s*\??\s*:(?!:)/g)?.length ?? 0) + (returns && returns.trim().startsWith(":") ? 1 : 0)
    result.set(name, Math.max(result.get(name) ?? 0, count))
  }
  for (const match of code.matchAll(/\bfunction\s+([\w$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(:\s*[^{=;]+)?/g)) add(match[1], match[2] ?? "", match[3])
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(:\s*[^=]+?)?\s*=>/g)) add(match[1], match[2] ?? "", match[3])
  return result
}

const LOOSE_CONFIG: ReadonlyArray<{ file: RegExp; looser: RegExp; stricter?: RegExp }> = [
  {
    file: /^[tj]sconfig(?:\.[\w.-]+)?\.json$/,
    looser: /"(?:strict|noImplicitAny|strictNullChecks|strictFunctionTypes|strictBindCallApply|noImplicitThis|noImplicitReturns|useUnknownInCatchVariables|noUncheckedIndexedAccess|exactOptionalPropertyTypes)"\s*:\s*false/g,
    stricter: /"strict"\s*:\s*true/g,
  },
  { file: /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.[\w]+)?|biome\.jsonc?|\.oxlintrc\.json)$/, looser: /:\s*["'](?:off|warn)["']|:\s*[01]\s*[,}\n]|"level"\s*:\s*"(?:off|warn)"/g },
  {
    file: /^(?:pyproject\.toml|mypy\.ini|\.mypy\.ini|setup\.cfg|pyrightconfig\.json)$/,
    looser: /\bstrict\s*=\s*false|\bignore_errors\s*=\s*true|\bdisallow_untyped_defs\s*=\s*false|typeCheckingMode"?\s*[=:]\s*"(?:off|basic)"/g,
    stricter: /\bstrict\s*=\s*true/g,
  },
]

function configLoosened(path: string, before: string, after: string): TypeErrorFinding | undefined {
  const name = basename(path)
  const fix = "fix the errors instead of relaxing the compiler or linter"
  if (/^phpstan\.neon(?:\.dist)?$/.test(name)) {
    const level = (text: string) => {
      const value = /\blevel:\s*(\d+|max)/.exec(text)?.[1]
      return value === undefined ? undefined : value === "max" ? 99 : Number(value)
    }
    const was = level(before)
    const now = level(after)
    return was !== undefined && now !== undefined && now < was ? { rule: "config-loosened", detail: `lowers the PHPStan level from ${was} to ${now}`, fix } : undefined
  }
  for (const config of LOOSE_CONFIG) {
    if (!config.file.test(name)) continue
    const count = (pattern: RegExp, text: string) => text.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0
    const looser = count(config.looser, after) > count(config.looser, before)
    const lostStrict = config.stricter !== undefined && count(config.stricter, after) < count(config.stricter, before)
    if (looser || lostStrict) return { rule: "config-loosened", detail: `relaxes type or lint checks in ${name}`, fix }
  }
  return undefined
}

/** Added hits: those beyond the count already in the file, reported by a line that is new when possible. */
function grown(before: Hit[], after: Hit[]): Hit | undefined {
  if (after.length <= before.length) return undefined
  const old = new Set(before.map((hit) => hit.line))
  return after.find((hit) => !old.has(hit.line)) ?? after[0]
}

export function isExemptFromTypeGuard(path: string): boolean {
  return isTestFile(path) || GENERATED.test(path.replace(/\\/g, "/"))
}

/** What this edit adds; empty when nothing grows. `before` is "" for a new file. */
export function typeErrorFindings(path: string, before: string, after: string): TypeErrorFinding[] {
  if (isExemptFromTypeGuard(path)) return []
  const config = configLoosened(path, before, after)
  if (config) return [config]
  const lang = langOf(path)
  if (!lang) return []
  const old = views(before, lang)
  const now = views(after, lang)
  const findings: TypeErrorFinding[] = []

  if (lang === "ts") {
    for (const escape of TYPE_ESCAPES) {
      const hit = grown(hitsOf(escape.pattern, before, old.code), hitsOf(escape.pattern, after, now.code))
      if (hit) findings.push({ rule: "type-escape", detail: escape.detail, fix: escape.fix, line: hit.line })
    }
    const was = signatures(old.code)
    for (const [name, count] of signatures(now.code)) {
      const previous = was.get(name)
      if (previous !== undefined && count < previous) {
        findings.push({ rule: "annotation-removed", detail: `removes type annotations from \`${name}\``, fix: "keep the parameter and return types; fix the code that does not match them" })
      }
    }
  }

  const swallowFix = "handle the error where you can act on it: recover, or rethrow with context (`new Error(msg, { cause: e })`), or log the full error and propagate it; never catch, log and carry on. If ignoring it is really intended, write why in a comment inside the block"
  const swallowedBefore = lang === "py" ? pythonSwallows(before, old) : lang === "go" ? goSwallows(before, old) : catchBlocks(before, old).swallowed
  const swallowedAfter = lang === "py" ? pythonSwallows(after, now) : lang === "go" ? goSwallows(after, now) : catchBlocks(after, now).swallowed
  const swallow = grown(swallowedBefore, swallowedAfter)
  if (swallow) findings.push({ rule: "swallowed-error", detail: "swallows an error (the failure disappears instead of being handled)", fix: swallowFix, line: swallow.line })

  if (lang !== "py" && lang !== "go") {
    const lost = grown(catchBlocks(before, old).noCause, catchBlocks(after, now).noCause)
    if (lost) findings.push({ rule: "rethrow-without-cause", detail: "rethrows a new error and drops the one it caught", fix: "pass the caught error on: `throw new Error(msg, { cause: e })`", line: lost.line })
  }
  return findings
}
