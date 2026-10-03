/**
 * A new test proves something only if it fails before the fix, for the right reason, and passes after it (fork roadmap
 * 0.9a; Meta ACH, arXiv 2501.12862). The plugin watches test runs and tells the agent when a new test proves nothing.
 */
import { basename, relative } from "node:path"

const RUNNER = /(?:^|[\s;&|(])(?:bun\s+test|bunx?\s+(?:jest|vitest)|npx\s+(?:jest|vitest|mocha)|pnpm\s+(?:exec\s+)?(?:jest|vitest)|jest|vitest|mocha|pytest|python3?\s+-m\s+(?:pytest|unittest)|go\s+test|(?:vendor\/bin\/)?(?:phpunit|pest)|php\s+artisan\s+test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::\S+)?|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\w*\s+test)(?=$|[\s;&|)])/
const WRONG_REASON = /SyntaxError|Cannot find module|Cannot find package|ModuleNotFoundError|ImportError|IndentationError|error TS\d+|ParseError|Parse error|undefined: \w+|cannot find package|could not import|Failed to load/

export type NewTestState = {
  readonly createdBy: string
  /** Set once any non-test file is edited after the test was written. */
  fixStarted: boolean
  failedForRightReason: boolean
  verdict?: "valid" | "invalid" | "passes-before"
  lastNote?: string
}

export function isTestRun(command: string): boolean {
  return RUNNER.test(command)
}

export function createTestRunTracker(directory: string) {
  const tests = new Map<string, NewTestState>()
  /** True once a non-test file was edited during the current user request. */
  let codeChangedThisRequest = false

  function targetsOf(command: string): string[] {
    const tokens = command.split(/\s+/).filter((token) => token && !token.startsWith("-"))
    const all = [...tests.keys()]
    const named = all.filter((path) => {
      const rel = relative(directory, path).replace(/\\/g, "/")
      return tokens.some((token) => token.length > 2 && (rel.includes(token.replace(/^\.\//, "")) || token.endsWith(basename(path))))
    })
    // A run that names no new test runs the whole suite, which includes every new test.
    const namesOtherFiles = tokens.some((token) => /\.(?:[cm]?[jt]sx?|py|go|php|rb)$/.test(token) || token.includes("/"))
    return named.length > 0 ? named : namesOtherFiles ? [] : all
  }

  return {
    recordCreated(path: string, sessionID: string): void {
      if (!tests.has(path)) tests.set(path, { createdBy: sessionID, fixStarted: codeChangedThisRequest, failedForRightReason: false })
    },
    /** A rewritten test is judged again from scratch. */
    recordTestEdited(path: string): void {
      const state = tests.get(path)
      if (!state) return
      state.verdict = undefined
      state.failedForRightReason = false
      state.fixStarted = codeChangedThisRequest
    },
    /** A new user request starts a new "before the fix" window. */
    newRequest(): void {
      codeChangedThisRequest = false
    },
    isNewTest(path: string): boolean {
      return tests.has(path)
    },
    createdBy(path: string): string | undefined {
      return tests.get(path)?.createdBy
    },
    recordSourceEdit(): void {
      codeChangedThisRequest = true
      for (const state of tests.values()) state.fixStarted = true
    },
    forget(path: string): void {
      tests.delete(path)
    },
    /** Notes to append to a test run's output, one per new test the run included. */
    recordRun(command: string, exitCode: number | undefined, output: string): string[] {
      if (!isTestRun(command) || exitCode === undefined) return []
      const notes: string[] = []
      const note = (state: NewTestState, text: string) => {
        state.lastNote = text
        notes.push(text)
      }
      const targets = targetsOf(command)
      for (const path of targets) {
        const state = tests.get(path)
        if (!state || state.verdict) continue
        const name = relative(directory, path)
        if (exitCode !== 0) {
          const failedHere = targets.length === 1 || output.includes(basename(path))
          if (!failedHere) continue
          const wrong = WRONG_REASON.exec(output)
          if (wrong) {
            note(state, `[test-integrity] ${name} fails for the WRONG reason (${wrong[0]}): it does not compile or import, so it proves nothing yet. Make it fail on an assertion; create a stub if the code does not exist yet.`)
          } else if (!state.fixStarted) {
            state.failedForRightReason = true
            note(state, `[test-integrity] ${name} fails before the fix, on an assertion: good, it reproduces the problem.`)
          }
          continue
        }
        if (state.failedForRightReason) {
          state.verdict = "valid"
          note(state, `[test-integrity] ${name} failed before the fix and passes now: valid test.`)
        } else if (!state.fixStarted) {
          state.verdict = "passes-before"
          note(state, `[test-integrity] ${name} passes before any code change. Fine ONLY if it covers behaviour that already works. If it is meant to reproduce a bug or specify new behaviour, it is INVALID: rewrite it so it fails for that reason; never weaken it to pass.`)
        } else {
          state.verdict = "invalid"
          note(state, `[test-integrity] UNPROVEN TEST: ${name} was never seen failing before the fix, so it does not prove the fix works. Say so in your report, or show it failing against the code before the fix.`)
        }
      }
      return notes
    },
    /** Status of the tests a session wrote, for the parent that delegated to it. */
    summaryFor(sessionID: string): string[] {
      const lines: string[] = []
      for (const [path, state] of tests) {
        if (state.createdBy !== sessionID) continue
        const name = relative(directory, path)
        if (state.verdict === "valid") lines.push(`- ${name}: valid (failed before the fix, passes after)`)
        else if (state.verdict === "passes-before") lines.push(`- ${name}: passed before any change — valid only as coverage of existing behaviour, NOT as a reproduction of a bug`)
        else if (state.verdict === "invalid") lines.push(`- ${name}: INVALID — ${state.lastNote ?? "never seen failing before the fix"}`)
        else if (state.failedForRightReason) lines.push(`- ${name}: fails for the right reason; must pass once the fix is in`)
        else lines.push(`- ${name}: NOT YET SEEN FAILING — run it before the fix; a test that never failed proves nothing`)
      }
      return lines
    },
    snapshot(): ReadonlyMap<string, NewTestState> {
      return tests
    },
  }
}

export type TestRunTracker = ReturnType<typeof createTestRunTracker>
