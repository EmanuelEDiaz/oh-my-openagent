/**
 * Hard web research suite (fork roadmap 4.18; user rule: test the worst cases). Every answer is newer than any model's
 * training data or needs a very specific source, and is graded live at grading time; two questions have no reliable
 * answer. Asked to web-researcher and, as the baseline, to librarian.
 */
import { answerHasLive, answerMatches, citedUrlsFromTools, ranAs, saysNotFound, toolNotUsed, urlsResolve } from "../../graders"
import type { Budget, Grader, Task } from "../../types"

const BUDGET: Budget = { maxTurns: 30, timeoutMs: 600_000 }
const json = async (url: string): Promise<unknown> => (await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "omo-bench" } })).json()

/** Tag and date (YYYY-MM-DD) of a GitHub repo's latest release. */
async function latestRelease(repo: string): Promise<{ tag: string; date: string }> {
  const data = (await json(`https://api.github.com/repos/${repo}/releases/latest`)) as { tag_name: string; published_at: string }
  return { tag: data.tag_name, date: data.published_at.slice(0, 10) }
}
/** Accept the bare version as well as the tag ("bun-v1.4.2" → "1.4.2"). */
const versionsOf = (tag: string) => [tag, tag.replace(/^[a-z-]*v/i, "")]

async function npmLatest(pkg: string): Promise<{ version: string; date: string }> {
  const data = (await json(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}`)) as { "dist-tags": { latest: string }; time: Record<string, string> }
  const version = data["dist-tags"].latest
  return { version, date: (data.time[version] ?? "").slice(0, 10) }
}

type Question = { readonly id: string; readonly prompt: string; readonly expect: readonly Grader[]; readonly unanswerable?: boolean; readonly holdout?: boolean }

const QUESTIONS: readonly Question[] = [
  { id: "opencode-release", prompt: "What is the most recent release of OpenCode (the AI coding agent, github.com/anomalyco/opencode), and on what date was it published?", expect: [
    answerHasLive("opencode tag", async () => versionsOf((await latestRelease("anomalyco/opencode")).tag)),
    answerHasLive("opencode date", async () => [(await latestRelease("anomalyco/opencode")).date]),
  ] },
  { id: "bun-release", prompt: "What is the latest Bun release and when was it published?", expect: [
    answerHasLive("bun tag", async () => versionsOf((await latestRelease("oven-sh/bun")).tag)),
    answerHasLive("bun date", async () => [(await latestRelease("oven-sh/bun")).date]),
  ] },
  { id: "node-lts", prompt: "What is the newest Node.js LTS release right now (exact version and codename)?", expect: [
    answerHasLive("node lts", async () => {
      const list = (await json("https://nodejs.org/dist/index.json")) as Array<{ version: string; lts: string | false }>
      const first = list.find((entry) => entry.lts)
      return first ? [first.version.replace(/^v/, "")] : []
    }),
  ] },
  { id: "zod-date", prompt: "On what date was the current latest version of the npm package `zod` published, and which version is it?", expect: [
    answerHasLive("zod version", async () => [(await npmLatest("zod")).version]),
    answerHasLive("zod date", async () => [(await npmLatest("zod")).date]),
  ] },
  { id: "ai-sdk-compat", prompt: "What is the latest version of the npm package `@ai-sdk/openai-compatible`?", expect: [
    answerHasLive("@ai-sdk/openai-compatible", async () => [(await npmLatest("@ai-sdk/openai-compatible")).version]),
  ] },
  { id: "zen-freetier-issue", prompt: "Since early October 2026, OpenCode Zen free models fail in the official OpenCode CLI with \"OpenCode's free tier can only be used from within OpenCode\". Find the GitHub issue in the official OpenCode repository that reports this for CLI 1.18.34 and give its number.", expect: [
    answerMatches([/52907/]),
  ] },
  { id: "zen-gate-tools", prompt: "Which OpenCode tools must be enabled for Zen's free tier to accept requests? Users report that disabling some built-in tools triggers \"free tier can only be used from within OpenCode\". Which tools, and in which GitHub issues was it reported?", expect: [
    answerMatches([/\bread\b/i, /\bbash\b|\bshell\b/i, /51315|51241|50627/]),
  ], holdout: true },
  { id: "bun-mock-scope", prompt: "In bun test, mock.module() leaks into other test files run in the same process. Is there an upstream fix, and what PR introduced it?", expect: [
    answerMatches([/31319|--isolate/]),
  ] },
  // No reliable answer: the right answer says so.
  { id: "none-maintainer", prompt: "What did the OpenCode maintainers officially say about why Zen's free tier requires the bash and read tools? Quote their statement.", expect: [saysNotFound()], unanswerable: true },
  { id: "none-node-30", prompt: "What is the codename of the Node.js 30 LTS line and its exact release date?", expect: [saysNotFound()], unanswerable: true },
]

function suite(agent: string, prefix: string, suffix: string): Task[] {
  return QUESTIONS.map((question) => ({
    id: `${prefix}/${question.id}`,
    agent,
    mode: "subtask" as const,
    fixture: "empty",
    prompt: `${question.prompt}${suffix}`,
    expect: [
      ranAs(agent),
      toolNotUsed(/^(write|edit|multiedit|apply_patch|patch|hashline_edit)$/),
      ...(question.unanswerable ? [] : [citedUrlsFromTools(), urlsResolve()]),
      ...question.expect,
    ],
    split: question.holdout ? ("holdout" as const) : ("dev" as const),
    budget: BUDGET,
  }))
}

export const WEB_RESEARCHER_HARD_TASKS: readonly Task[] = suite("web-researcher", "web-researcher-hard", "")
export const LIBRARIAN_HARD_TASKS: readonly Task[] = suite("librarian", "librarian-hard", "\n\nAnswer with the sources (URLs) you used.")
