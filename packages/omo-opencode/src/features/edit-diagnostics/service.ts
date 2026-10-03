/**
 * After each edit: report only the errors it introduced and undo edits that break the syntax (fork roadmap 0.9a).
 * Uses the diagnostics OpenCode already computes for edit/write/apply_patch; no second language server is started.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { normalize, resolve } from "node:path"

import { changesFromArgs, lineDiff } from "../test-integrity/change"
import { classifyErrors, errorsOf, renderNewErrors, type LspDiagnostic, type NewError } from "./diagnostics"
import { checkSyntax, hasStandaloneChecker } from "./syntax"

const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "hashline_edit"])
const OPENCODE_BLOCK = /\n*LSP errors detected in (?:this file|other files), please fix:\n(?:<diagnostics file="[^"]*">[\s\S]*?<\/diagnostics>\n?)+/g

type Target = {
  readonly path: string
  readonly original: string | undefined
  knownBefore: readonly LspDiagnostic[] | undefined
  readonly syntaxOkBefore: boolean
}

export type EditDiagnosticsOptions = {
  readonly directory: string
  readonly revertSyntaxErrors: boolean
  /** Called with the errors an edit introduced (the loop breaker counts them in 0.9b). */
  readonly onNewErrors?: (sessionID: string, errors: readonly NewError[]) => void
  /**
   * Diagnostics from the plugin's shared LSP daemon, for files OpenCode reports none for (its own LSP is off unless
   * opencode.json sets `lsp`, and the hashline edit never reports them). Asked before and after, so the comparison is
   * exact.
   */
  readonly fallbackDiagnostics?: (path: string) => Promise<LspDiagnostic[] | undefined>
}

function key(path: string): string {
  const absolute = normalize(resolve(path))
  return process.platform === "win32" ? absolute.toLowerCase() : absolute
}

function readText(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined
  } catch {
    return undefined
  }
}

/** 0-based line numbers in `after` that are not unchanged lines of `before`. */
export function changedLineNumbers(before: string, after: string): Set<number> {
  const counts = new Map<string, number>()
  for (const line of before.split(/\r?\n/)) counts.set(line, (counts.get(line) ?? 0) + 1)
  const changed = new Set<number>()
  after.split(/\r?\n/).forEach((line, index) => {
    const left = counts.get(line) ?? 0
    if (left > 0) counts.set(line, left - 1)
    else changed.add(index)
  })
  return changed
}

function identifiers(lines: readonly string[]): Set<string> {
  const found = new Set<string>()
  for (const line of lines) for (const match of line.matchAll(/[A-Za-z_$][\w$]{2,}/g)) found.add(match[0])
  return found
}

export function createEditDiagnostics(options: EditDiagnosticsOptions) {
  /** Last errors seen per file, from any edit's diagnostics map. */
  const known = new Map<string, LspDiagnostic[]>()
  const pending = new Map<string, Target[]>()

  return {
    async before(tool: string, callID: string, args: Record<string, unknown>): Promise<void> {
      if (!WRITE_TOOLS.has(tool.toLowerCase())) return
      const changes = changesFromArgs(tool, args, options.directory).filter((change) => change.kind !== "delete")
      if (changes.length === 0) return
      const targets: Target[] = changes
        .map((change) => {
          const original = readText(change.path)
          return {
            path: change.path,
            original,
            knownBefore: known.get(key(change.path)),
            syntaxOkBefore: original !== undefined && options.revertSyntaxErrors && hasStandaloneChecker(change.path) ? !checkSyntax(change.path) : true,
          }
        })
      if (targets.length === 0) return
      if (options.fallbackDiagnostics) {
        for (const target of targets) {
          if (target.original === undefined || target.knownBefore) continue
          const list = await options.fallbackDiagnostics(target.path).catch(() => undefined)
          if (list) target.knownBefore = errorsOf(list)
        }
      }
      pending.set(callID, targets)
      if (pending.size > 200) pending.delete(pending.keys().next().value as string)
    },

    /** Rewrites the tool output: OpenCode's full error list is replaced by the errors this edit introduced. */
    async after(input: { tool: string; sessionID: string; callID: string }, output: { output?: string; metadata?: Record<string, unknown> }): Promise<void> {
      const targets = pending.get(input.callID)
      pending.delete(input.callID)
      if (!targets || !WRITE_TOOLS.has(input.tool.toLowerCase())) return
      const raw = output.metadata?.["diagnostics"]
      const map = new Map<string, LspDiagnostic[]>()
      if (raw && typeof raw === "object") {
        for (const [file, list] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(list)) map.set(key(file), list as LspDiagnostic[])
        }
      }
      if (options.fallbackDiagnostics) {
        for (const target of targets) {
          if (map.has(key(target.path))) continue
          const list = await options.fallbackDiagnostics(target.path).catch(() => undefined)
          if (list) map.set(key(target.path), list)
        }
      }
      const notes: string[] = []
      const introducedAll: NewError[] = []
      let preexistingAll = 0
      const reverted = new Set<string>()

      for (const target of targets) {
        const after = readText(target.path) ?? ""
        const diff = lineDiff(target.original ?? "", after)
        const diagnostics = map.get(key(target.path))
        let syntaxBroken: { line?: number; message: string } | undefined
        if (diagnostics) {
          const { introduced, preexisting } = classifyErrors(target.path, diagnostics, {
            ...(target.knownBefore ? { before: target.knownBefore } : {}),
            changedLines: changedLineNumbers(target.original ?? "", after),
            touchedNames: identifiers([...diff.added, ...diff.removed]),
            fileText: after,
          })
          const syntax = introduced.find((error) => error.syntax)
          if (syntax) syntaxBroken = { line: syntax.line, message: syntax.message }
          introducedAll.push(...introduced)
          preexistingAll += preexisting
        }
        if (!syntaxBroken && target.syntaxOkBefore && options.revertSyntaxErrors && hasStandaloneChecker(target.path)) {
          syntaxBroken = checkSyntax(target.path)
        }
        if (syntaxBroken && options.revertSyntaxErrors && target.original !== undefined) {
          writeFileSync(target.path, target.original)
          reverted.add(key(target.path))
          notes.push(`[edit-diagnostics] EDIT UNDONE: it broke the syntax of ${target.path}${syntaxBroken.line ? ` at line ${syntaxBroken.line}` : ""}: ${syntaxBroken.message.replace(/\.+$/, "")}. The file is back as it was before this edit; make the edit again, correctly.`)
        } else if (syntaxBroken && options.revertSyntaxErrors && target.original === undefined) {
          rmSync(target.path, { force: true })
          reverted.add(key(target.path))
          notes.push(`[edit-diagnostics] FILE NOT CREATED: ${target.path} had a syntax error${syntaxBroken.line ? ` at line ${syntaxBroken.line}` : ""}: ${syntaxBroken.message}. Write it again, correctly.`)
        }
      }

      // Errors this edit caused in other files the plugin has seen before (e.g. callers of a renamed function).
      const targetKeys = new Set(targets.map((target) => key(target.path)))
      if (reverted.size === 0) {
        for (const [file, list] of map) {
          const before = known.get(file)
          if (targetKeys.has(file) || !before) continue
          const { introduced } = classifyErrors(file, list, { before, changedLines: new Set(), touchedNames: new Set(), fileText: readText(file) ?? "" })
          introducedAll.push(...introduced)
        }
      }
      for (const [file, list] of map) {
        if (!reverted.has(file)) known.set(file, errorsOf(list))
      }
      const introduced = introducedAll.filter((error) => !reverted.has(key(error.file)))
      if (map.size > 0 || notes.length > 0) {
        const report = renderNewErrors(options.directory, introduced, preexistingAll)
        const body = (output.output ?? "").replace(OPENCODE_BLOCK, "").trimEnd()
        output.output = [body, ...notes, report].filter(Boolean).join("\n\n")
      }
      if (introduced.length > 0) options.onNewErrors?.(input.sessionID, introduced)
    },
  }
}

export type EditDiagnostics = ReturnType<typeof createEditDiagnostics>
