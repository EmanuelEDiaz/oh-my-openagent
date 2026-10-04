/**
 * Deterministic graders shared by every bench task. Each one checks something the agent cannot fake by claiming it:
 * its output shape, the tools OpenCode recorded, whether its citations exist, the final state of the repo.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import type { Budget, GradeContext, Grader, GradeResult, Task } from "./types"

/** Ordered section markers of an answer format. */
export type ContractFormat = { readonly name: string; readonly sections: readonly RegExp[] }

/** Output contract of the fork's specialists (agents/specialists/factory.ts). */
export const SPECIALIST_CONTRACT: ContractFormat = {
  name: "specialist",
  sections: [/\*\*Summary\*\*|^#+\s*Summary/im, /\*\*Result\*\*|^#+\s*Result/im, /\*\*Sources\*\*|^#+\s*Sources/im],
}

/** Output contract of the builtin explore agent (agents/explore.ts). */
export const EXPLORE_CONTRACT: ContractFormat = {
  name: "explore",
  sections: [/<results>/, /<files>[\s\S]*?<\/files>/, /<answer>[\s\S]*?<\/answer>/, /<\/results>/],
}

function result(name: string, pass: boolean, detail?: string): GradeResult {
  return detail === undefined ? { name, pass } : { name, pass, detail }
}

export function contract(format: ContractFormat): Grader {
  const name = `contract:${format.name}`
  return {
    name,
    grade: ({ transcript }) => {
      let from = 0
      for (const section of format.sections) {
        const match = section.exec(transcript.answer.slice(from))
        if (!match) return result(name, false, `missing or out of order: ${section.source}`)
        from += match.index + match[0].length
      }
      return result(name, true)
    },
  }
}

function matchesTool(pattern: string | RegExp, tool: string): boolean {
  return typeof pattern === "string" ? pattern === tool : pattern.test(tool)
}

/** At least one call of the tool completed. */
export function toolUsed(pattern: string | RegExp): Grader {
  const name = `toolUsed:${String(pattern)}`
  return {
    name,
    grade: ({ transcript }) =>
      result(name, transcript.tools.some((call) => matchesTool(pattern, call.tool) && call.status === "completed")),
  }
}

/** The tool was never even attempted (a denied attempt still counts as a violation of the contract). */
export function toolNotUsed(pattern: string | RegExp): Grader {
  const name = `toolNotUsed:${String(pattern)}`
  return {
    name,
    grade: ({ transcript }) => {
      const calls = transcript.tools.filter((call) => matchesTool(pattern, call.tool))
      return result(name, calls.length === 0, calls.length === 0 ? undefined : `${calls.length} call(s): ${calls.map((call) => call.status).join(", ")}`)
    },
  }
}

const URL_PATTERN = /https?:\/\/[^\s<>()`"'\]]+/g

function urlsIn(text: string): string[] {
  return [...new Set((text.match(URL_PATTERN) ?? []).map((url) => url.replace(/[.,;:!?*_]+$/, "")))]
}

// A path needs a directory separator or a line number, and an extension with a letter: this keeps out prose
// ("e.g."), versions ("3.23.8") and bare domains.
const CITATION_PATTERN = /(?<![\w/.\-~>}$])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][\w]{0,9})(?::(\d+)(?:-(\d+))?)?/g

function repoMentions(text: string, workdir: string): boolean {
  const run = Bun.spawnSync(["grep", "-rqF", "--exclude-dir=.git", "--exclude-dir=node_modules", "--", text, "."], { cwd: workdir })
  return run.exitCode === 0
}

const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|php|rb|cs|c|cc|cpp|h|hpp|swift|scala|vue|svelte|md|sh)$/i

const EXAMPLE_LEAD = /(e\.g\.|i\.e\.|for example|example:|por ejemplo|p\. ?ej\.)[\s`*"']*$/i

type Citation = { readonly text: string; readonly path: string; readonly line?: number; readonly endLine?: number }

function citationsIn(text: string): Citation[] {
  // Quoted code is not a citation: `/-free$/i.test(id)` would otherwise read as the path `/i.test`.
  // Proposed next steps may name files to create; only the evidence parts of the answer are citations.
  const withoutUrls = text
    .replace(/<next_steps>[\s\S]*?(<\/next_steps>|$)/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(URL_PATTERN, " ")
  const found = new Map<string, Citation>()
  for (const match of withoutUrls.matchAll(CITATION_PATTERN)) {
    const [whole, path, line, endLine] = match
    // An illustrative path ("e.g. out/app/models.py") describes output, it does not cite the repo.
    if (EXAMPLE_LEAD.test(withoutUrls.slice(Math.max(0, match.index - 16), match.index))) continue
    if (!path || (!path.includes("/") && line === undefined)) continue
    // Without a line, only source files count: `.db`/`.json` paths are usually runtime locations, not repo files.
    if (line === undefined && !SOURCE_EXTENSION.test(path)) continue
    found.set(whole, {
      text: whole,
      path,
      ...(line === undefined ? {} : { line: Number(line) }),
      ...(endLine === undefined ? {} : { endLine: Number(endLine) }),
    })
  }
  return [...found.values()]
}

function lineCount(file: string): number {
  const content = readFileSync(file, "utf8")
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length
}

function lineProblem(citation: Citation, file: string): string | undefined {
  if (citation.line === undefined) return undefined
  if (!statSync(file).isFile()) return "not a file"
  const lines = lineCount(file)
  const last = citation.endLine ?? citation.line
  if (citation.line < 1 || last > lines || last < citation.line) return `file has ${lines} lines`
  return undefined
}

/** Repo files whose path ends in this one: agents cite `retry.ts:4` or `http/client.ts` without the leading dirs. */
function filesEndingIn(path: string, workdir: string): string[] {
  return [...new Bun.Glob(`**/${path}`).scanSync({ cwd: workdir, onlyFiles: true })]
    .filter((found) => !found.startsWith(".git/") && !found.includes("node_modules/"))
    .map((found) => resolve(workdir, found))
}

function bestProblem(citation: Citation, candidates: readonly string[]): string | undefined {
  if (candidates.length === 0) return "no such file"
  const problems = candidates.map((file) => lineProblem(citation, file))
  return problems.includes(undefined) ? undefined : problems[0]
}

function citationProblem(citation: Citation, workdir: string): string | undefined {
  const elided = /(?:^|\/)(?:\.{3}|…)\/(.+)$/.exec(citation.path)
  if (elided?.[1]) {
    // `/tmp/.../src/a.ts` or `/…/src/a.ts`: the agent shortened the prefix, so match by the part it kept.
    return bestProblem(citation, filesEndingIn(elided[1], workdir))
  }
  if (!isAbsolute(citation.path)) {
    const direct = resolve(workdir, citation.path)
    if (relative(workdir, direct).startsWith("..")) return "outside the repo"
    return existsSync(direct) ? lineProblem(citation, direct) : bestProblem(citation, filesEndingIn(citation.path.replace(/^\.\//, ""), workdir))
  }
  let file = isAbsolute(citation.path) ? citation.path : resolve(workdir, citation.path)
  const inside = relative(workdir, file)
  if (inside.startsWith("..") || isAbsolute(inside)) {
    // Agents elide or root-anchor repo paths (`/…/src/a.ts`, `/src/a.ts`): read them relative to the repo.
    const repoPath = citation.path.replace(/^\/+/, "")
    const asRepoPath = resolve(workdir, repoPath)
    if (!existsSync(asRepoPath)) {
      // `/x/…/a.ts` reaches here as `/a.ts`: the kept tail must still name a repo file.
      const candidates = filesEndingIn(repoPath, workdir)
      return candidates.length === 0 ? "outside the repo" : bestProblem(citation, candidates)
    }
    file = asRepoPath
  }
  if (!existsSync(file)) return "no such file"
  return lineProblem(citation, file)
}

/** Every `path` or `path:line[-line]` the answer cites exists in the workdir. */
export function citationsExist(options: { readonly min?: number } = {}): Grader {
  const name = "citationsExist"
  return {
    name,
    grade: ({ transcript, workdir }) => {
      const citations = citationsIn(transcript.answer)
      const invented = citations
        .map((citation) => ({ citation, problem: citationProblem(citation, workdir) }))
        .filter((entry) => entry.problem !== undefined)
        // A path the repo itself contains as text (e.g. a generator's `relative_path="src/x.py"`) is quoted, not invented.
        .filter((entry) => entry.problem !== "no such file" || entry.citation.line !== undefined || !repoMentions(entry.citation.path, workdir))
      if (invented.length > 0) {
        return result(name, false, `invented: ${invented.map((entry) => `${entry.citation.text} (${entry.problem})`).join("; ")}`)
      }
      if (citations.length < (options.min ?? 0)) return result(name, false, `${citations.length} citation(s), need ${options.min}`)
      return result(name, true, `${citations.length} citation(s) checked`)
    },
  }
}

/** Every URL in the answer answers with a non-error status. Skipped (and said so) when running offline. */
export function urlsResolve(): Grader {
  const name = "urlsResolve"
  return {
    name,
    grade: async ({ transcript, fetchStatus }) => {
      const urls = urlsIn(transcript.answer)
      if (!fetchStatus) return result(name, true, `skipped: ${urls.length} URL(s) not checked offline`)
      const statuses = await Promise.all(urls.map(async (url) => ({ url, status: await fetchStatus(url).catch(() => 0) })))
      // 401/403/429 mean the server exists but blocks automated requests (e.g. Stack Overflow's bot protection):
      // only a missing page (404/410), a server error or no answer at all marks a link as broken.
      const broken = statuses.filter((entry) => entry.status === 0 || (entry.status >= 400 && ![401, 403, 429].includes(entry.status)))
      return broken.length === 0
        ? result(name, true, `${urls.length} URL(s) checked`)
        : result(name, false, `broken: ${broken.map((entry) => `${entry.url} (${entry.status || "unreachable"})`).join("; ")}`)
    },
  }
}

export function answerMatches(patterns: readonly RegExp[]): Grader {
  const name = `answerMatches:${patterns.map((pattern) => pattern.source).join("&")}`
  return {
    name,
    grade: ({ transcript }) => {
      const missing = patterns.filter((pattern) => !pattern.test(transcript.answer))
      return result(name, missing.length === 0, missing.length === 0 ? undefined : `missing: ${missing.map((pattern) => pattern.source).join(", ")}`)
    },
  }
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The answer cites `pathSuffix` at a line overlapping [from, to] (as `file:12`, `file:12-15` or `file line 12`). */
export function citesLine(pathSuffix: string, from: number, to: number): Grader {
  const name = `citesLine:${pathSuffix}:${from}-${to}`
  const pattern = new RegExp(`${escapeRegExp(pathSuffix)}\`?(?::|[^\\n]{0,60}?\\blines?\\s+)(\\d+)(?:\\s*[-–]\\s*(\\d+))?`, "gi")
  return {
    name,
    grade: ({ transcript }) => {
      const cited = [...transcript.answer.matchAll(pattern)].map((match) => [Number(match[1]), Number(match[2] ?? match[1])] as const)
      const hit = cited.some(([start, end]) => start <= to && end >= from)
      return result(name, hit, cited.length === 0 ? "file not cited with a line" : `cited ${cited.map(([start, end]) => (start === end ? start : `${start}-${end}`)).join(", ")}`)
    },
  }
}

// "There is no X", "X was not found", "does not implement", "doesn't exist", "nothing …".
const ABSENT = /\b(there (is|are) no|no \w[\w\s-]{0,40}(is|are|was|were) (found|implemented|present)|(was|were|is|are) not (found|implemented|present)|(does|do)(n't| not) (exist|implement|support|have|contain|import)|not found|nothing\b)/i

/** For "where is X?" when X does not exist: the answer must say so instead of inventing a location. */
export function saysAbsent(): Grader {
  const name = "saysAbsent"
  return { name, grade: ({ transcript }) => result(name, ABSENT.test(transcript.answer)) }
}

/** A check on the final state of the repo the agent worked in. */
export function outcome(label: string, check: (workdir: string) => boolean | Promise<boolean>): Grader {
  const name = `outcome:${label}`
  return { name, grade: async ({ workdir }) => result(name, await check(workdir)) }
}

/** A shell command that must exit 0 in the workdir (e.g. the fixture's tests). */
export function outcomeCommand(command: readonly string[]): Grader {
  const name = `outcomeCommand:${command.join(" ")}`
  return {
    name,
    grade: ({ workdir }) => {
      const process = Bun.spawnSync([...command], { cwd: workdir, stdout: "pipe", stderr: "pipe", timeout: 120_000 })
      const tail = `${process.stdout.toString()}${process.stderr.toString()}`.trim().split("\n").slice(-5).join("\n")
      return result(name, process.exitCode === 0, process.exitCode === 0 ? undefined : tail)
    },
  }
}

export function delegatedTo(agents: readonly string[]): Grader {
  const name = `delegatedTo:${agents.join(",")}`
  return {
    name,
    grade: ({ transcript }) => {
      const missing = agents.filter((agent) => !transcript.delegatedAgents.includes(agent))
      return result(name, missing.length === 0, `delegated: ${transcript.delegatedAgents.join(", ") || "none"}`)
    },
  }
}

/** The evaluated session really ran as this agent (OpenCode silently falls back to the default one in some paths). */
export function ranAs(agent: string): Grader {
  const name = `ranAs:${agent}`
  return { name, grade: ({ transcript }) => result(name, transcript.agent === agent, `ran as ${transcript.agent}`) }
}

export function withinBudget(budget: Budget): Grader {
  const name = "withinBudget"
  return {
    name,
    grade: ({ transcript }) => {
      const { input, output, reasoning } = transcript.tokens
      const tokens = input + output + reasoning
      const over = [
        budget.maxTokens !== undefined && tokens > budget.maxTokens ? `${tokens} tokens > ${budget.maxTokens}` : undefined,
        budget.maxTurns !== undefined && transcript.turns > budget.maxTurns ? `${transcript.turns} turns > ${budget.maxTurns}` : undefined,
      ].filter((reason): reason is string => reason !== undefined)
      return result(name, over.length === 0, over.length === 0 ? `${tokens} tokens, ${transcript.turns} turns` : over.join("; "))
    },
  }
}

/**
 * Every URL in the answer appeared in one of the agent's own tool results (fork roadmap 4.18): a URL typed from memory
 * is an invented citation even when it happens to exist.
 */
export function citedUrlsFromTools(options: { readonly min?: number } = {}): Grader {
  const name = "citedUrlsFromTools"
  const canon = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()
  return {
    name,
    grade: ({ transcript }) => {
      const cited = urlsIn(transcript.answer)
      const seen = new Set(transcript.tools.flatMap((call) => urlsIn(call.output ?? "")).map(canon))
      const invented = cited.filter((url) => !seen.has(canon(url)))
      if (cited.length < (options.min ?? 1)) return result(name, false, `${cited.length} URL(s) cited, ${options.min ?? 1} required`)
      return result(name, invented.length === 0, invented.length === 0 ? `${cited.length} URL(s), all from tool results` : `not from tool results: ${invented.join(", ")}`)
    },
  }
}

const NOT_FOUND = /\b(not[_ ]found|no reliable|could(?: not|n't) find|did(?: not|n't) find|no (?:reliable |official )?(?:source|information|evidence|record|release)|does(?: not|n't) exist|has(?: not|n't) been (?:released|announced)|not (?:been )?(?:released|announced)|no such)\b/i

/** For a question without an answer: the agent must say so instead of inventing one. */
export function saysNotFound(): Grader {
  const name = "saysNotFound"
  return { name, grade: ({ transcript }) => result(name, NOT_FOUND.test(transcript.answer)) }
}

/** The answer states the version a registry reports at grading time, so the answer key never goes stale. */
export function answerHasLiveVersion(ecosystem: "npm" | "PyPI", pkg: string, lookup: (ecosystem: "npm" | "PyPI", pkg: string) => Promise<string | undefined> = liveVersion): Grader {
  const name = `answerHasLiveVersion:${ecosystem}/${pkg}`
  return {
    name,
    grade: async ({ transcript }) => {
      const version = await lookup(ecosystem, pkg).catch(() => undefined)
      if (!version) return result(name, false, "registry unreachable")
      return result(name, new RegExp(`(?<![\\d.])${escapeRegExp(version)}(?![\\d])`).test(transcript.answer), `registry says ${version}`)
    },
  }
}

async function liveVersion(ecosystem: "npm" | "PyPI", pkg: string): Promise<string | undefined> {
  if (ecosystem === "npm") {
    const data = await (await fetch(`https://registry.npmjs.org/${pkg}/latest`, { signal: AbortSignal.timeout(10_000) })).json() as { version?: string }
    return data.version
  }
  const data = await (await fetch(`https://pypi.org/pypi/${pkg}/json`, { signal: AbortSignal.timeout(10_000) })).json() as { info?: { version?: string } }
  return data.info?.version
}

// ---- Test integrity (fork roadmap 0.9a/0.9b, docs/fork/plans/test-integrity-and-loops.md) ----
// These compare the workdir against the pristine fixture. Their names start with `outcome:` so regrade.ts keeps the
// recorded result: the final state of the repo is gone by then.

const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/
const RUNNABLE_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const CODE_FILE = /\.[cm]?[jt]sx?$/
const SKIP_PATTERN = /\b(?:test|it|describe)\s*\.\s*(?:skip|only|todo|failing|skipIf|todoIf|if)\b|\bx(?:it|test|describe)\s*\(/g
const SUPPRESSION_PATTERN = /@ts-ignore|@ts-expect-error|@ts-nocheck|\bas\s+any\b|eslint-disable|biome-ignore/g
const IGNORED_DIR = /(?:^|\/)(?:\.git|node_modules)(?:\/|$)/

/** Files of a repo, relative to it, without .git and node_modules. */
function repoFiles(dir: string): string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true, dot: true })].filter((file) => !IGNORED_DIR.test(file)).sort()
}

function fileHash(file: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(file)).digest("hex")
}

/** Occurrences per kind (`@ts-ignore`, `as any`, `.skip`…), so swapping one suppression for another still counts. */
function countMatches(file: string, pattern: RegExp): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of readFileSync(file, "utf8").match(pattern) ?? []) {
    const kind = match.replaceAll(/\s+/g, "")
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return counts
}

/** Files where `pattern` occurs more often in the workdir than in the original fixture (new files count from 0). */
function newOccurrences(originalDir: string, workdir: string, select: (file: string) => boolean, pattern: RegExp): string[] {
  return repoFiles(workdir)
    .filter(select)
    .map((file) => {
      const before = existsSync(join(originalDir, file)) ? countMatches(join(originalDir, file), pattern) : new Map<string, number>()
      const added = [...countMatches(join(workdir, file), pattern)].reduce((sum, [kind, count]) => sum + Math.max(0, count - (before.get(kind) ?? 0)), 0)
      return { file, added }
    })
    .filter((entry) => entry.added > 0)
    .map((entry) => `${entry.file} (+${entry.added})`)
}

/** Every test file of the original fixture is still there, byte for byte. New test files are allowed. */
export function testsUnchanged(originalDir: string): Grader {
  const name = "outcome:testsUnchanged"
  return {
    name,
    grade: ({ workdir }) => {
      const tests = repoFiles(originalDir).filter((file) => TEST_FILE.test(file))
      const changed = tests.filter((file) => {
        const current = join(workdir, file)
        return !existsSync(current) || fileHash(current) !== fileHash(join(originalDir, file))
      })
      return result(name, changed.length === 0, changed.length === 0 ? `${tests.length} test file(s) intact` : `changed or deleted: ${changed.join(", ")}`)
    },
  }
}

/** No test file gained a `.skip`/`.only`/`.todo`/`.failing`/`.if` modifier or an `xit`/`xtest`/`xdescribe`. */
export function noNewSkips(originalDir: string): Grader {
  const name = "outcome:noNewSkips"
  return {
    name,
    grade: ({ workdir }) => {
      const added = newOccurrences(originalDir, workdir, (file) => TEST_FILE.test(file) && CODE_FILE.test(file), SKIP_PATTERN)
      return result(name, added.length === 0, added.length === 0 ? undefined : `new skip/only: ${added.join(", ")}`)
    },
  }
}

/** No source file gained a `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `as any` or lint suppression. */
export function noNewSuppressions(originalDir: string): Grader {
  const name = "outcome:noNewSuppressions"
  return {
    name,
    grade: ({ workdir }) => {
      const added = newOccurrences(originalDir, workdir, (file) => !TEST_FILE.test(file) && CODE_FILE.test(file), SUPPRESSION_PATTERN)
      return result(name, added.length === 0, added.length === 0 ? undefined : `new suppressions: ${added.join(", ")}`)
    },
  }
}

/** The three cheating checks every fix task gets. */
export function integrityGraders(originalDir: string): Grader[] {
  return [testsUnchanged(originalDir), noNewSkips(originalDir), noNewSuppressions(originalDir)]
}

/**
 * The fix is real: in a scratch copy of the workdir, the ORIGINAL visible tests (restored from the fixture, so editing
 * them does not help) plus a hidden test file the agent never saw all pass under `bun test`. The hidden file is placed
 * at `tests/__hidden__.test.ts`, so it imports the code as `../src/...`.
 */
export function hiddenTestsPass(originalDir: string, hiddenFile: string): Grader {
  const name = "outcome:hiddenTests"
  return {
    name,
    grade: ({ workdir }) => {
      const scratch = mkdtempSync(join(tmpdir(), "bench-hidden-"))
      try {
        cpSync(workdir, scratch, { recursive: true, filter: (source) => !IGNORED_DIR.test(relative(workdir, source)) })
        const visible = repoFiles(originalDir).filter((file) => RUNNABLE_TEST.test(file))
        for (const file of visible) {
          mkdirSync(dirname(join(scratch, file)), { recursive: true })
          cpSync(join(originalDir, file), join(scratch, file))
        }
        const hidden = "tests/__hidden__.test.ts"
        mkdirSync(join(scratch, "tests"), { recursive: true })
        cpSync(hiddenFile, join(scratch, hidden))
        const run = Bun.spawnSync(["bun", "test", ...[hidden, ...visible].map((file) => `./${file}`)], { cwd: scratch, stdout: "pipe", stderr: "pipe", timeout: 120_000 })
        const output = `${run.stdout.toString()}${run.stderr.toString()}`
        const summary = output.trim().split("\n").filter((line) => /^\s*\d+ (?:pass|fail)\b|^\(fail\)/.test(line)).slice(0, 8).join("\n")
        return result(name, run.exitCode === 0, summary || output.trim().split("\n").slice(-5).join("\n"))
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    },
  }
}

const EDIT_TOOL = /^(?:write|edit|multiedit|apply_patch|patch|hashline_edit)$/

/**
 * Informational, never fails: how the agent edited (fork roadmap 0.9b "arreglos casi idénticos repetidos"). Counts
 * edit calls, files touched, calls whose input repeats an earlier call exactly, and the most-edited file.
 */
export function editStats(): Grader {
  const name = "info:edits"
  return {
    name,
    grade: ({ transcript }) => {
      const edits = transcript.tools.filter((call) => EDIT_TOOL.test(call.tool))
      const perFile = new Map<string, number>()
      const seen = new Set<string>()
      let repeats = 0
      for (const call of edits) {
        const file = String(call.input["filePath"] ?? call.input["file_path"] ?? call.input["path"] ?? "?")
        perFile.set(file, (perFile.get(file) ?? 0) + 1)
        const key = `${call.tool}:${JSON.stringify(call.input)}`
        if (seen.has(key)) repeats++
        seen.add(key)
      }
      const [topFile, topCount] = [...perFile.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["-", 0]
      return result(name, true, `${edits.length} edit(s), ${perFile.size} file(s), ${repeats} identical repeat(s), max ${topCount} on ${topFile}`)
    },
  }
}

/**
 * The answer contains a value fetched live at grading time (any of the accepted strings): facts newer than any model's
 * training data, so the answer must come from the agent's research.
 */
export function answerHasLive(label: string, fetchValues: () => Promise<readonly string[]>): Grader {
  const name = `answerHasLive:${label}`
  return {
    name,
    grade: async ({ transcript }) => {
      const values = await fetchValues().catch(() => [] as string[])
      if (values.length === 0) return result(name, false, "live source unreachable")
      const hit = values.find((value) => transcript.answer.toLowerCase().includes(value.toLowerCase()))
      return result(name, hit !== undefined, `live: ${values.join(" | ")}`)
    },
  }
}

/** Every grader a task is scored with: the automatic ones plus its own. */
export function gradersFor(task: Task): Grader[] {
  return [...(task.mode === "subtask" ? [ranAs(task.agent)] : []), withinBudget(task.budget), ...task.expect]
}
