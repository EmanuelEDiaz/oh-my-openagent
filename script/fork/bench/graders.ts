/**
 * Deterministic graders shared by every bench task. Each one checks something the agent cannot fake by claiming it:
 * its output shape, the tools OpenCode recorded, whether its citations exist, the final state of the repo.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

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
const CITATION_PATTERN = /(?<![\w/.-])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][\w]{0,9})(?::(\d+)(?:-(\d+))?)?/g

type Citation = { readonly text: string; readonly path: string; readonly line?: number; readonly endLine?: number }

function citationsIn(text: string): Citation[] {
  // Quoted code is not a citation: `/-free$/i.test(id)` would otherwise read as the path `/i.test`.
  const withoutUrls = text.replace(/```[\s\S]*?```/g, " ").replace(URL_PATTERN, " ")
  const found = new Map<string, Citation>()
  for (const match of withoutUrls.matchAll(CITATION_PATTERN)) {
    const [whole, path, line, endLine] = match
    if (!path || (!path.includes("/") && line === undefined)) continue
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
  if (!isAbsolute(citation.path)) {
    const direct = resolve(workdir, citation.path)
    if (relative(workdir, direct).startsWith("..")) return "outside the repo"
    return existsSync(direct) ? lineProblem(citation, direct) : bestProblem(citation, filesEndingIn(citation.path.replace(/^\.\//, ""), workdir))
  }
  let file = isAbsolute(citation.path) ? citation.path : resolve(workdir, citation.path)
  const inside = relative(workdir, file)
  const elided = /(?:^|\/)(?:\.{3}|…)\/(.+)$/.exec(citation.path)
  if (elided?.[1]) {
    // `/tmp/.../src/a.ts` or `/…/src/a.ts`: the agent shortened the prefix, so match by the part it kept.
    return bestProblem(citation, filesEndingIn(elided[1], workdir))
  }
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
      const broken = statuses.filter((entry) => entry.status === 0 || entry.status >= 400)
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

/** Every grader a task is scored with: the automatic ones plus its own. */
export function gradersFor(task: Task): Grader[] {
  return [...(task.mode === "subtask" ? [ranAs(task.agent)] : []), withinBudget(task.budget), ...task.expect]
}
