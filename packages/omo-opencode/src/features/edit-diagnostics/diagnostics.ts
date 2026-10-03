/**
 * Only the type errors an edit introduced, with location, expected/actual and alternatives (fork roadmap 0.9a).
 * OpenCode appends every LSP error of the file after an edit; small models then chase errors they did not cause.
 */
import { relative } from "node:path"

export type LspDiagnostic = {
  readonly range: { readonly start: { readonly line: number; readonly character: number } }
  readonly message: string
  readonly severity?: number
  readonly code?: string | number
  readonly source?: string
}

export type NewError = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly code?: string
  readonly message: string
  readonly expected?: string
  readonly actual?: string
  readonly alternatives: readonly string[]
  readonly syntax: boolean
}

/** Identity of an error that survives line shifts: code + message without numbers that move. */
export function errorKey(diagnostic: LspDiagnostic): string {
  return `${diagnostic.code ?? ""}|${diagnostic.message.replace(/\s+/g, " ").trim()}`
}

export function errorsOf(list: readonly LspDiagnostic[] | undefined): LspDiagnostic[] {
  return (list ?? []).filter((diagnostic) => (diagnostic.severity ?? 1) === 1)
}

/** TypeScript syntax errors are TS1xxx; pyright and others say so in the message. */
export function isSyntaxError(diagnostic: LspDiagnostic): boolean {
  const code = typeof diagnostic.code === "number" ? diagnostic.code : Number(String(diagnostic.code ?? "").replace(/^TS/i, ""))
  if (Number.isFinite(code) && code >= 1000 && code < 1200) return true
  return /^(?:Expected expression|Unexpected token|Unterminated|Invalid character|Declaration or statement expected|Expected ['"`]?[^'"`]+['"`]? but|SyntaxError|invalid syntax|expected ['"`]?[;:,)}\]])/i.test(diagnostic.message)
}

function identifiersIn(lines: readonly string[]): Set<string> {
  const found = new Set<string>()
  for (const line of lines) for (const match of line.matchAll(/[A-Za-z_$][\w$]{2,}/g)) found.add(match[0])
  return found
}

function quotedNames(message: string): string[] {
  return [...message.matchAll(/['"`]([A-Za-z_$][\w$.]*)['"`]/g)].map((match) => match[1] ?? "").filter(Boolean)
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] ?? 0
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] ?? 0
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length] ?? 0
}

/** Names in the file close to the unknown name in the error, nearest first. */
export function similarNames(message: string, fileText: string): string[] {
  const unknown = /(?:Cannot find name|Property|has no exported member|Module .* has no exported member|is not defined|undefined name|has no attribute|undefined:)\s*['"`]?([A-Za-z_$][\w$]*)/i.exec(message)?.[1]
  if (!unknown) return []
  const pool = identifiersIn(fileText.split(/\r?\n/))
  pool.delete(unknown)
  const limit = Math.max(1, Math.floor(unknown.length / 3))
  return [...pool]
    .map((name) => ({ name, distance: editDistance(name.toLowerCase(), unknown.toLowerCase()) }))
    .filter((candidate) => candidate.distance <= limit)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((candidate) => candidate.name)
}

function expectedActual(message: string): { expected?: string; actual?: string } {
  const assign = /Type ['"`](.+?)['"`] is not assignable to type ['"`](.+?)['"`]/.exec(message)
  if (assign) return { actual: assign[1], expected: assign[2] }
  const argument = /Argument of type ['"`](.+?)['"`] is not assignable to parameter of type ['"`](.+?)['"`]/.exec(message)
  if (argument) return { actual: argument[1], expected: argument[2] }
  const count = /Expected (\d+(?:-\d+)?) arguments?, but got (\d+)/.exec(message)
  if (count) return { expected: `${count[1]} argument(s)`, actual: `${count[2]}` }
  const py = /(?:Argument of type|Expression of type) "(.+?)" (?:cannot be assigned to|is incompatible with) (?:parameter .* of type |declared type )"(.+?)"/.exec(message)
  if (py) return { actual: py[1], expected: py[2] }
  return {}
}

export type FileEditContext = {
  /** Errors of this file the plugin saw before the edit; undefined when it never saw the file's diagnostics. */
  readonly before?: readonly LspDiagnostic[]
  /** 0-based line numbers (after the edit) of lines the edit added or changed. */
  readonly changedLines: ReadonlySet<number>
  /** Identifiers the edit added or removed: an error naming one of them was caused by the edit. */
  readonly touchedNames: ReadonlySet<string>
  readonly fileText: string
}

/** Split the file's errors after an edit into those it introduced and those that were already there. */
export function classifyErrors(file: string, after: readonly LspDiagnostic[], context: FileEditContext): { introduced: NewError[]; preexisting: number } {
  const errors = errorsOf(after)
  const remaining = new Map<string, number>()
  for (const diagnostic of errorsOf(context.before)) remaining.set(errorKey(diagnostic), (remaining.get(errorKey(diagnostic)) ?? 0) + 1)
  const introduced: NewError[] = []
  let preexisting = 0
  for (const diagnostic of errors) {
    let isNew: boolean
    if (context.before) {
      const left = remaining.get(errorKey(diagnostic)) ?? 0
      isNew = left === 0
      if (left > 0) remaining.set(errorKey(diagnostic), left - 1)
    } else {
      isNew = context.changedLines.has(diagnostic.range.start.line)
        || quotedNames(diagnostic.message).some((name) => context.touchedNames.has(name.split(".").pop() ?? name))
    }
    if (!isNew) {
      preexisting++
      continue
    }
    const { expected, actual } = expectedActual(diagnostic.message)
    const didYouMean = /Did you mean ['"`]?([^'"`?]+)['"`]?\?/.exec(diagnostic.message)?.[1]
    const alternatives = [...new Set([...(didYouMean ? [didYouMean] : []), ...similarNames(diagnostic.message, context.fileText)])].slice(0, 3)
    introduced.push({
      file,
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      ...(diagnostic.code !== undefined ? { code: String(diagnostic.code) } : {}),
      message: diagnostic.message.split("\n")[0] ?? diagnostic.message,
      ...(expected ? { expected } : {}),
      ...(actual ? { actual } : {}),
      alternatives,
      syntax: isSyntaxError(diagnostic),
    })
  }
  return { introduced, preexisting }
}

export function renderNewErrors(directory: string, introduced: readonly NewError[], preexisting: number): string {
  if (introduced.length === 0) {
    return preexisting > 0 ? `[edit-diagnostics] No new errors from this edit (${preexisting} error(s) were already there; not caused by it).` : ""
  }
  const lines = introduced.slice(0, 15).map((error) => {
    const head = `- ${relative(directory, error.file) || error.file}:${error.line}:${error.column}${error.code ? ` ${error.code}` : ""} ${error.message}`
    const detail = [
      error.expected || error.actual ? `expected ${error.expected ?? "?"}, got ${error.actual ?? "?"}` : "",
      error.alternatives.length > 0 ? `did you mean: ${error.alternatives.join(", ")}?` : "",
    ].filter(Boolean).join("; ")
    return detail ? `${head}\n  ${detail}` : head
  })
  const more = introduced.length > 15 ? `\n… and ${introduced.length - 15} more` : ""
  const old = preexisting > 0 ? `\n(${preexisting} other error(s) were already there before this edit; not caused by it.)` : ""
  return `[edit-diagnostics] NEW errors introduced by this edit (${introduced.length}). Fix these first:\n${lines.join("\n")}${more}${old}`
}
