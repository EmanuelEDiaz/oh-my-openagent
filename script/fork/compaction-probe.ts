#!/usr/bin/env bun
/**
 * Compaction loss probe (fork roadmap 1.6).
 *
 * Seeds a session with concrete facts, does a little work, forces a compaction, then asks for every fact
 * with tools disabled and scores what survived. Runs against an isolated OpenCode sandbox you prepare:
 *
 *   bun script/fork/compaction-probe.ts --sandbox <dir> --project <dir> --model opencode/big-pickle --runs 3 --scenario hard --out result.json
 *
 * <sandbox> must contain home/, config/, data/, state/, cache/ (XDG roots) — never point it at your real config.
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk/v2"

type Fact = { readonly id: string; readonly question: string; readonly expect: readonly RegExp[] }

type Scenario = { readonly turns: readonly string[]; readonly facts: readonly Fact[]; readonly files?: Record<string, string> }

const EASY: Scenario = {
  turns: [
    [
      "Context for this project, please keep it in mind:",
      "1. Never use lodash in this project.",
      "2. All timestamps must be stored in UTC.",
      "3. We chose Valkey over Redis because of Redis's 2024 license change.",
      "4. The cache TTL is configured in src/cache.ts line 3.",
      "5. The last test run failed with error code E_CACHE_TIMEOUT_42.",
      "6. Open question: should cache keys be prefixed with the tenant id?",
      "7. Pending task: add a retry with jitter to the cache client.",
      "Just acknowledge in one short sentence.",
    ].join("\n"),
    "Read src/cache.ts and describe it in one sentence.",
    "List the files of this project and say in one sentence what the project is.",
  ],
  facts: [
    { id: "constraint-lodash", question: "Which library must never be used?", expect: [/lodash/i] },
    { id: "constraint-utc", question: "In which timezone must timestamps be stored?", expect: [/\bUTC\b/i] },
    { id: "decision-valkey", question: "Which cache did we choose and why?", expect: [/valkey/i, /licen[cs]e/i] },
    { id: "file-line", question: "Where is the cache TTL configured (file and line)?", expect: [/src\/cache\.ts/i, /\b3\b/] },
    { id: "error-code", question: "What was the exact error code of the last failed test run?", expect: [/E_CACHE_TIMEOUT_42/] },
    { id: "open-question", question: "What open question did I raise?", expect: [/tenant/i] },
    { id: "pending-task", question: "What task is pending?", expect: [/jitter/i] },
  ],
}

function bigModule(): string {
  const lines = ["// generated fixture: cache helpers"]
  for (let index = 0; index < 120; index++) {
    lines.push(
      `export async function cacheHelper${index}(key: string): Promise<string | undefined> {`,
      `  // TODO(${index % 7 === 0 ? "perf" : "cleanup"}): helper ${index} normalizes the key before lookup`,
      `  return key.length > ${index} ? key.slice(0, ${index + 1}) : undefined`,
      "}",
      "",
    )
  }
  return `${lines.join("\n")}\n`
}

/** Facts scattered across a longer session with noisy work, a later correction and exact values. */
const HARD: Scenario = {
  files: { "src/big.ts": bigModule() },
  turns: [
    "We are going to work on the cache module. Constraint: never use lodash in this project. Acknowledge briefly.",
    "Read src/big.ts and summarize in 3 bullets what its exported functions do.",
    "Also: all timestamps must be stored in UTC, and pin zod to exactly 3.23.8. Acknowledge briefly.",
    "Run `wc -l src/*.ts` and report the line counts.",
    "Decision: we rejected Memcached because it has no persistence, and chose Valkey because of Redis's 2024 license change. Acknowledge briefly.",
    "Read src/big.ts again and list every function whose TODO is tagged perf.",
    "The cache port is 6379. Acknowledge briefly.",
    "Grep src for TODO(cleanup) and tell me how many there are.",
    "Correction: the cache port is 6380, not 6379. Acknowledge briefly.",
    "The last CI run failed with E_CACHE_TIMEOUT_42 in tests/cache.test.ts:17. Acknowledge briefly.",
    "Read the last 150 lines of src/big.ts and describe them in 2 sentences.",
    "Open question: should cache keys be prefixed with the tenant id? Pending task: add a retry with jitter to the cache client. The env var for the key prefix will be CACHE_NS_PREFIX. Acknowledge briefly.",
  ],
  facts: [
    { id: "constraint-lodash", question: "Which library must never be used?", expect: [/lodash/i] },
    { id: "constraint-utc", question: "In which timezone must timestamps be stored?", expect: [/\bUTC\b/i] },
    { id: "pin-zod", question: "Which exact zod version must be pinned?", expect: [/3\.23\.8/] },
    { id: "rejected-option", question: "Which cache option was rejected and why?", expect: [/memcached/i, /persist/i] },
    { id: "decision-valkey", question: "Which cache did we choose and why?", expect: [/valkey/i, /licen[cs]e/i] },
    { id: "correction-port", question: "What is the cache port?", expect: [/6380/] },
    { id: "error-location", question: "What was the exact error code of the last CI failure and where (file:line)?", expect: [/E_CACHE_TIMEOUT_42/, /cache\.test\.ts\D{0,8}17/i] },
    { id: "open-question", question: "What open question did I raise?", expect: [/tenant/i] },
    { id: "pending-task", question: "What task is pending?", expect: [/jitter/i] },
    { id: "env-var", question: "What is the env var for the key prefix?", expect: [/CACHE_NS_PREFIX/] },
  ],
}

const SCENARIOS: Record<string, Scenario> = { easy: EASY, hard: HARD }

// Only the tools that could recover the original chat are disabled: OpenCode's free tier rejects requests with no tools
// at all (403 "can only be used from within OpenCode"). Any tool the model still calls is recorded in the result.
const NO_RECALL_TOOLS = Object.fromEntries(
  ["task", "knowledge_search", "knowledge_open", "decision_search", "session_search", "session_read", "session_list",
    "session_info", "call_omo_agent", "background_output"]
    .map((name) => [name, false]),
)

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? fallback : process.argv[index + 1]
  if (value === undefined) throw new Error(`missing --${name}`)
  return value
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

const TURN_TIMEOUT_MS = 240_000

/** Free models sometimes stall mid-stream with no error; abort the turn so the run is discarded instead of hanging. */
async function turn<T>(client: ReturnType<typeof createOpencodeClient>, sessionID: string, label: string, call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${TURN_TIMEOUT_MS / 1000}s`)), TURN_TIMEOUT_MS)
  })
  try {
    return await Promise.race([call(), timeout])
  } catch (error) {
    await client.session.abort({ sessionID }).catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function textOf(parts: unknown): string {
  return (Array.isArray(parts) ? parts : [])
    .filter((part): part is { type: string; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text")
    .map((part) => part.text)
    .join("\n")
}

function score(facts: readonly Fact[], answer: string): Record<string, boolean> {
  const lines = answer.split("\n")
  return Object.fromEntries(facts.map((fact, index) => {
    const numbered = lines.find((line) => new RegExp(`^\\s*\\**${index + 1}[.)]`).test(line)) ?? ""
    const haystack = numbered.length > 0 ? numbered : answer
    return [fact.id, fact.expect.every((pattern) => pattern.test(haystack))]
  }))
}

async function runOnce(baseUrl: string, project: string, model: { providerID: string; modelID: string }, agent: string, scenario: Scenario) {
  const client = createOpencodeClient({ baseUrl, directory: project })
  const created = await client.session.create({ title: "compaction-probe" })
  const sessionID = (created.data as { id: string }).id
  for (const [index, text] of scenario.turns.entries()) {
    await turn(client, sessionID, `turn ${index + 1}`, () => client.session.prompt({ sessionID, agent, model, parts: [{ type: "text", text }] }))
  }

  await turn(client, sessionID, "summarize", () => client.session.summarize({ sessionID, providerID: model.providerID, modelID: model.modelID, auto: false }))

  const messages = ((await client.session.messages({ sessionID })).data ?? []) as { info: { role: string; summary?: boolean }; parts: unknown[] }[]
  const summary = messages.filter((message) => message.info.summary).map((message) => textOf(message.parts)).join("\n")

  const question = [
    "Answer from memory only, without tools, as a numbered list with exactly these numbers:",
    ...scenario.facts.map((fact, index) => `${index + 1}. ${fact.question}`),
    "If you do not know an answer, write \"unknown\" for it.",
  ].join("\n")
  const probe = await turn(client, sessionID, "probe", () => client.session.prompt({ sessionID, agent, model, tools: NO_RECALL_TOOLS, parts: [{ type: "text", text: question }] }))
  const probeData = probe.data as { info?: { error?: unknown }; parts?: unknown[] } | undefined
  if (probeData?.info?.error) throw new Error(`probe turn failed: ${JSON.stringify(probeData.info.error).slice(0, 300)}`)
  const after = ((await client.session.messages({ sessionID })).data ?? []) as { info: { role: string }; parts: { type: string; tool?: string }[] }[]
  const probeTurn = after.slice(messages.length + 1)
  const toolsUsed = probeTurn.flatMap((message) => message.parts.filter((part) => part.type === "tool").map((part) => part.tool ?? "?"))
  const answer = textOf((probeData?.parts))

  const recalled = score(scenario.facts, answer)
  const inSummary = Object.fromEntries(scenario.facts.map((fact) => [fact.id, fact.expect.every((pattern) => pattern.test(summary))]))
  return {
    sessionID,
    recalled,
    recalledCount: Object.values(recalled).filter(Boolean).length,
    inSummaryCount: Object.values(inSummary).filter(Boolean).length,
    inSummary,
    toolsUsed,
    summaryChars: summary.length,
    answer,
  }
}

async function main(): Promise<void> {
  const sandbox = arg("sandbox")
  const project = arg("project")
  const [providerID, ...rest] = arg("model", "opencode/big-pickle").split("/")
  const model = { providerID: providerID ?? "opencode", modelID: rest.join("/") }
  const runs = Number(arg("runs", "1"))
  const agent = arg("agent", "Sisyphus - ultraworker")
  const out = arg("out", join(sandbox, "compaction-probe.json"))
  const scenarioName = arg("scenario", "easy")
  const scenario = SCENARIOS[scenarioName]
  if (!scenario) throw new Error(`unknown --scenario ${scenarioName} (use: ${Object.keys(SCENARIOS).join(", ")})`)
  for (const [path, content] of Object.entries(scenario.files ?? {})) {
    mkdirSync(dirname(join(project, path)), { recursive: true })
    writeFileSync(join(project, path), content)
  }
  const port = await freePort()

  const server = spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: project,
    env: {
      ...process.env,
      HOME: join(sandbox, "home"),
      XDG_CONFIG_HOME: join(sandbox, "config"),
      XDG_DATA_HOME: join(sandbox, "data"),
      XDG_STATE_HOME: join(sandbox, "state"),
      XDG_CACHE_HOME: join(sandbox, "cache"),
    },
    stdio: "ignore",
  })
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await fetch(`${baseUrl}/config`).then((response) => response.ok, () => false)) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const results = []
    // Failed runs (provider errors, stalls) are kept in the output but retried, up to twice the requested runs.
    for (let attempt = 0; attempt < runs * 2 && results.filter((result) => "recalledCount" in result).length < runs; attempt++) {
      try {
        results.push(await runOnce(baseUrl, project, model, agent, scenario))
      } catch (error) {
        results.push({ error: String(error) })
      }
      console.log(JSON.stringify(results.at(-1)).slice(0, 300))
    }
    const ok = results.filter((result): result is Awaited<ReturnType<typeof runOnce>> => "recalledCount" in result)
    const summary = {
      model: `${model.providerID}/${model.modelID}`,
      scenario: scenarioName,
      runs: results.length,
      completed: ok.length,
      facts: scenario.facts.length,
      meanRecalled: ok.length === 0 ? 0 : ok.reduce((sum, result) => sum + result.recalledCount, 0) / ok.length,
      meanInSummary: ok.length === 0 ? 0 : ok.reduce((sum, result) => sum + result.inSummaryCount, 0) / ok.length,
      perFact: Object.fromEntries(scenario.facts.map((fact) => [fact.id, ok.filter((result) => result.recalled[fact.id]).length])),
      results,
    }
    writeFileSync(out, JSON.stringify(summary, null, 2))
    console.log(JSON.stringify({ ...summary, results: undefined }, null, 2))
  } finally {
    server.kill("SIGKILL")
  }
}

await main()
