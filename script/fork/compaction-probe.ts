#!/usr/bin/env bun
/**
 * Compaction loss probe (fork roadmap 1.6).
 *
 * Seeds a session with concrete facts, does a little work, forces a compaction, then asks for every fact
 * with tools disabled and scores what survived. Runs against an isolated OpenCode sandbox you prepare:
 *
 *   bun script/fork/compaction-probe.ts --sandbox <dir> --project <dir> --model opencode/big-pickle --runs 3 --out result.json
 *
 * <sandbox> must contain home/, config/, data/, state/, cache/ (XDG roots) — never point it at your real config.
 */
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk/v2"

type Fact = { readonly id: string; readonly question: string; readonly expect: readonly RegExp[] }

const SEED = [
  "Context for this project, please keep it in mind:",
  "1. Never use lodash in this project.",
  "2. All timestamps must be stored in UTC.",
  "3. We chose Valkey over Redis because of Redis's 2024 license change.",
  "4. The cache TTL is configured in src/cache.ts line 3.",
  "5. The last test run failed with error code E_CACHE_TIMEOUT_42.",
  "6. Open question: should cache keys be prefixed with the tenant id?",
  "7. Pending task: add a retry with jitter to the cache client.",
  "Just acknowledge in one short sentence.",
].join("\n")

const FACTS: readonly Fact[] = [
  { id: "constraint-lodash", question: "Which library must never be used?", expect: [/lodash/i] },
  { id: "constraint-utc", question: "In which timezone must timestamps be stored?", expect: [/\bUTC\b/i] },
  { id: "decision-valkey", question: "Which cache did we choose and why?", expect: [/valkey/i, /licen[cs]e/i] },
  { id: "file-line", question: "Where is the cache TTL configured (file and line)?", expect: [/src\/cache\.ts/i, /\b3\b/] },
  { id: "error-code", question: "What was the exact error code of the last failed test run?", expect: [/E_CACHE_TIMEOUT_42/] },
  { id: "open-question", question: "What open question did I raise?", expect: [/tenant/i] },
  { id: "pending-task", question: "What task is pending?", expect: [/jitter/i] },
]

const WORK = [
  "Read src/cache.ts and describe it in one sentence.",
  "List the files of this project and say in one sentence what the project is.",
]

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

function textOf(parts: unknown): string {
  return (Array.isArray(parts) ? parts : [])
    .filter((part): part is { type: string; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text")
    .map((part) => part.text)
    .join("\n")
}

function score(answer: string): Record<string, boolean> {
  const lines = answer.split("\n")
  return Object.fromEntries(FACTS.map((fact, index) => {
    const numbered = lines.find((line) => new RegExp(`^\\s*\\**${index + 1}[.)]`).test(line)) ?? ""
    const haystack = numbered.length > 0 ? numbered : answer
    return [fact.id, fact.expect.every((pattern) => pattern.test(haystack))]
  }))
}

async function runOnce(baseUrl: string, project: string, model: { providerID: string; modelID: string }, agent: string) {
  const client = createOpencodeClient({ baseUrl, directory: project })
  const created = await client.session.create({ title: "compaction-probe" })
  const sessionID = (created.data as { id: string }).id
  await client.session.prompt({ sessionID, agent, model, parts: [{ type: "text", text: SEED }] })
  for (const text of WORK) await client.session.prompt({ sessionID, agent, model, parts: [{ type: "text", text }] })

  await client.session.summarize({ sessionID, providerID: model.providerID, modelID: model.modelID, auto: false })

  const messages = ((await client.session.messages({ sessionID })).data ?? []) as { info: { role: string; summary?: boolean }; parts: unknown[] }[]
  const summary = messages.filter((message) => message.info.summary).map((message) => textOf(message.parts)).join("\n")

  const question = [
    "Answer from memory only, without tools, as a numbered list with exactly these numbers:",
    ...FACTS.map((fact, index) => `${index + 1}. ${fact.question}`),
    "If you do not know an answer, write \"unknown\" for it.",
  ].join("\n")
  const probe = await client.session.prompt({ sessionID, agent, model, tools: NO_RECALL_TOOLS, parts: [{ type: "text", text: question }] })
  const probeData = probe.data as { info?: { error?: unknown }; parts?: unknown[] } | undefined
  if (probeData?.info?.error) throw new Error(`probe turn failed: ${JSON.stringify(probeData.info.error).slice(0, 300)}`)
  const after = ((await client.session.messages({ sessionID })).data ?? []) as { info: { role: string }; parts: { type: string; tool?: string }[] }[]
  const probeTurn = after.slice(messages.length + 1)
  const toolsUsed = probeTurn.flatMap((message) => message.parts.filter((part) => part.type === "tool").map((part) => part.tool ?? "?"))
  const answer = textOf((probeData?.parts))

  const recalled = score(answer)
  const inSummary = Object.fromEntries(FACTS.map((fact) => [fact.id, fact.expect.every((pattern) => pattern.test(summary))]))
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
    for (let run = 0; run < runs; run++) {
      try {
        results.push(await runOnce(baseUrl, project, model, agent))
      } catch (error) {
        results.push({ error: String(error) })
      }
      console.log(JSON.stringify(results.at(-1)).slice(0, 300))
    }
    const ok = results.filter((result): result is Awaited<ReturnType<typeof runOnce>> => "recalledCount" in result)
    const summary = {
      model: `${model.providerID}/${model.modelID}`,
      runs: results.length,
      completed: ok.length,
      facts: FACTS.length,
      meanRecalled: ok.length === 0 ? 0 : ok.reduce((sum, result) => sum + result.recalledCount, 0) / ok.length,
      meanInSummary: ok.length === 0 ? 0 : ok.reduce((sum, result) => sum + result.inSummaryCount, 0) / ok.length,
      perFact: Object.fromEntries(FACTS.map((fact) => [fact.id, ok.filter((result) => result.recalled[fact.id]).length])),
      results,
    }
    writeFileSync(out, JSON.stringify(summary, null, 2))
    console.log(JSON.stringify({ ...summary, results: undefined }, null, 2))
  } finally {
    server.kill("SIGKILL")
  }
}

await main()
