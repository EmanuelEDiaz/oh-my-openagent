/**
 * Test-integrity guard (fork roadmap 0.9a). Asking a model not to cheat leaves cheating at 70–80 % (METR 2025);
 * read-only tests and an explicit way out ("stop and ask") are what work, so both are enforced here, in code.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

import { changesFromArgs, lineDiff, type FileChange } from "./change"
import { blockingFindings, stringLiterals, warningFindings, type Finding } from "./checks"
import { createTestRunTracker, isTestRun } from "./test-runs"
import { isTestFile, siblingTestCandidates } from "./test-files"

export const TEST_WRITER_AGENT = "test-writer"
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "hashline_edit"])
const UNLOCK_ANSWER = /^\s*(?:allow|permitir)\s+(?:editing|editar)\s+(.+?)\s*$/i
const ALL_TESTS = /^(?:all tests|todos los tests)\b/i

export type GuardDeps = {
  readonly directory: string
  /** Config key of the agent running the session (e.g. "test-writer"), if known. */
  readonly agentOf: (sessionID: string) => Promise<string | undefined>
  /** The top-level session of a session tree, so a user's approval covers its subagents. */
  readonly rootOf: (sessionID: string) => Promise<string>
}

type Pending = { readonly changes: FileChange[]; readonly originals: Map<string, string | undefined>; readonly warnings: Finding[] }

function readText(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined
  } catch {
    return undefined
  }
}

export function createTestIntegrityGuard(deps: GuardDeps) {
  const tracker = createTestRunTracker(deps.directory)
  const unlocks = new Map<string, { all: boolean; files: Set<string> }>()
  const pending = new Map<string, Pending>()
  const rel = (path: string) => relative(deps.directory, path) || path

  function unlocked(root: string, path: string): boolean {
    const entry = unlocks.get(root)
    return !!entry && (entry.files.has(path) || (entry.all && isTestFile(path)))
  }

  function testLiterals(sourcePath: string): string[] {
    for (const candidate of siblingTestCandidates(sourcePath)) {
      const text = readText(candidate)
      if (text !== undefined) return stringLiterals(text)
    }
    return []
  }

  function cheatMessage(path: string, findings: Finding[]): string {
    const list = findings.map((finding) => `- ${finding.detail}${finding.line ? `: \`${finding.line.slice(0, 120)}\`` : ""}`).join("\n")
    return [
      `[test-integrity] BLOCKED: this change to ${rel(path)} would make checks pass without fixing anything:`,
      list,
      `Fix the cause instead. If you are sure this change is right, do not work around the block: stop and ask the user with the question tool, offering the option "Allow editing ${rel(path)}" and explaining why.`,
    ].join("\n")
  }

  function protectedMessage(path: string): string {
    return [
      `[test-integrity] BLOCKED: ${rel(path)} is an existing test. Tests are the specification: change the code, not the test.`,
      `If you believe the test itself is wrong, do NOT edit it: stop and ask the user with the question tool, offering the option "Allow editing ${rel(path)}" and explaining why. New tests are written by the test-writer specialist.`,
    ].join("\n")
  }

  return {
    tracker,

    /** Throws to refuse the tool call; the message is what the model sees. */
    async before(tool: string, sessionID: string, callID: string, args: Record<string, unknown>): Promise<void> {
      if (!WRITE_TOOLS.has(tool.toLowerCase())) return
      const changes = changesFromArgs(tool, args, deps.directory)
      if (changes.length === 0) return
      const agent = await deps.agentOf(sessionID)
      const root = await deps.rootOf(sessionID)
      const isTestWriter = agent === TEST_WRITER_AGENT
      const warnings: Finding[] = []
      for (const change of changes) {
        const test = isTestFile(change.path)
        if (unlocked(root, change.path)) continue
        if (isTestWriter && !test) {
          throw new Error(`[test-integrity] BLOCKED: test-writer writes tests only; ${rel(change.path)} is not a test file. Report the code change that is needed instead of making it.`)
        }
        const existing = change.kind !== "add" && !(tracker.isNewTest(change.path) && tracker.createdBy(change.path) === sessionID)
        if (test && existing && !isTestWriter) throw new Error(protectedMessage(change.path))
        if (change.exact) {
          const findings = blockingFindings(change)
          if (findings.length > 0) throw new Error(cheatMessage(change.path, findings))
        }
        warnings.push(...warningFindings(change, testLiterals))
      }
      const originals = new Map(changes.map((change) => [change.path, readText(change.path)] as const))
      pending.set(callID, { changes, originals, warnings })
      // A call that fails never reaches after(); keep the map bounded.
      if (pending.size > 200) pending.delete(pending.keys().next().value as string)
    },

    /** Returns text to append to the tool output (empty when there is nothing to say). */
    async after(input: { tool: string; sessionID: string; callID: string; args: Record<string, unknown> }, output: { output?: string; metadata?: Record<string, unknown> }): Promise<string> {
      const tool = input.tool.toLowerCase()
      const notes: string[] = []

      if (tool === "bash") {
        const command = typeof input.args["command"] === "string" ? input.args["command"] : ""
        if (!isTestRun(command)) return ""
        const exit = output.metadata?.["exit"]
        notes.push(...tracker.recordRun(command, typeof exit === "number" ? exit : undefined, output.output ?? ""))
      } else if (tool === "question") {
        const root = await deps.rootOf(input.sessionID)
        const answers = Array.isArray(output.metadata?.["answers"]) ? (output.metadata?.["answers"] as unknown[]) : []
        for (const answer of answers.flat()) {
          const target = typeof answer === "string" ? UNLOCK_ANSWER.exec(answer)?.[1]?.replace(/^["'`]|["'`]$/g, "") : undefined
          if (!target) continue
          const entry = unlocks.get(root) ?? { all: false, files: new Set<string>() }
          if (ALL_TESTS.test(target)) entry.all = true
          else entry.files.add(isAbsolute(target) ? target : resolve(deps.directory, target))
          unlocks.set(root, entry)
          notes.push(`[test-integrity] The user allowed editing ${target} for this task.`)
        }
      } else if (tool === "task" || tool === "call_omo_agent") {
        const child = typeof output.metadata?.["sessionId"] === "string"
          ? output.metadata["sessionId"]
          : /\b(ses_[A-Za-z0-9]+)\b/.exec(output.output ?? "")?.[1]
        const summary = child ? tracker.summaryFor(child) : []
        if (summary.length > 0) notes.push(`[test-integrity] New tests written by this task:\n${summary.join("\n")}`)
      } else if (WRITE_TOOLS.has(tool)) {
        const entry = pending.get(input.callID)
        pending.delete(input.callID)
        if (!entry) return ""
        const root = await deps.rootOf(input.sessionID)
        for (const change of entry.changes) {
          const before = entry.originals.get(change.path)
          if (!change.exact && !unlocked(root, change.path)) {
            // Hashline edits: judge the real result now and undo it if it cheats.
            const actual = { ...change, ...lineDiff(before ?? "", readText(change.path) ?? ""), exact: true }
            const findings = blockingFindings(actual)
            if (findings.length > 0) {
              if (before === undefined) rmSync(change.path, { force: true })
              else writeFileSync(change.path, before)
              notes.push(`${cheatMessage(change.path, findings)}\nThe edit was UNDONE; the file is back as it was.`)
              continue
            }
            entry.warnings.push(...warningFindings(actual, testLiterals))
          }
          if (isTestFile(change.path)) {
            if (change.kind === "add") tracker.recordCreated(change.path, input.sessionID)
            else if (change.kind === "delete") tracker.forget(change.path)
            else tracker.recordTestEdited(change.path)
          } else {
            tracker.recordSourceEdit()
          }
        }
        for (const warning of entry.warnings) {
          notes.push(`[test-integrity] Warning: ${warning.detail}${warning.line ? `: \`${warning.line.slice(0, 120)}\`` : ""}. Prefer a real fix.`)
        }
      }
      return notes.join("\n\n")
    },

    /** A real (not synthetic) user message in a top-level session starts a new request. */
    newRequest(): void {
      tracker.newRequest()
    },

    forgetSession(sessionID: string): void {
      unlocks.delete(sessionID)
    },
  }
}

export type TestIntegrityGuard = ReturnType<typeof createTestIntegrityGuard>
