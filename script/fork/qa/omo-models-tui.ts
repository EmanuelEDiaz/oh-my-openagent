#!/usr/bin/env bun
/**
 * Real-TUI QA of /omo-models (fork plan real-use-incidents A1, roadmap rule 17). Drives the user's real `opencode`
 * TUI in a sandbox and reads which model OpenCode really used from its own log, for the four cases the incident left:
 *
 *   1. live change: omo.jsonc saved while the TUI runs → the next message uses the new primary
 *   2. resumed session: change + restart + `--continue` → the old session moves to today's primary
 *   3. /models pick: a model chosen by hand in OpenCode's own dialog is respected
 *   4. retired model: the agent's configured model is deprecated → the TUI's stand-in is replaced by a usable one
 *   5. the /omo-models dialog itself saves the chain and opens OpenCode's model list
 *
 *   bun script/fork/qa/omo-models-tui.ts --plugin <dist>/index.js [--only 1,2,3,4,5]
 *
 * Only free Zen models are used (the sandbox default is free and every chain below is free). Evidence goes to
 * .omo/evidence/omo-models-tui/<timestamp>/ (never committed).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { parseJsonc } from "../../../packages/utils/src/jsonc-parser"
import type { Sandbox } from "../bench/sandbox"
import { availableMb, modelsFromLog, startTui, type TuiSession } from "./tui-driver"

const REPO = join(import.meta.dir, "../../..")
const RESERVE_MB = 3072
const TUI_COST_MB = 1024

const LING = "ling-3.1-flash-free"
const NEMOTRON = "nemotron-3.5-lightning-free"
const MIMO = "mimo-v2.6-flash-free"
const PICKLE = "big-pickle"
const RETIRED = "glm-5-free"

type Result = { readonly name: string; readonly pass: boolean; readonly detail: string }

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** Rewrites only the sandbox's omo.jsonc: the sisyphus chain. */
function setSisyphusChain(sandbox: Sandbox, models: readonly string[]): void {
  const path = join(sandbox.root, "home/.omo/omo.jsonc")
  const config = (existsSync(path) ? parseJsonc<Record<string, unknown>>(readFileSync(path, "utf8")) : {}) ?? {}
  const scope = ((config["[opencode]"] as Record<string, unknown> | undefined) ?? (config["[opencode]"] = {})) as Record<string, unknown>
  const agents = ((scope["agents"] as Record<string, unknown> | undefined) ?? (scope["agents"] = {})) as Record<string, unknown>
  agents["sisyphus"] = { models: models.map((model) => `opencode/${model}`) }
  writeFileSync(path, JSON.stringify(config, null, 2))
}

function pluginLog(sandbox: Sandbox): string {
  const path = join(sandbox.root, "tmp/oh-my-opencode.log")
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

/** Sends a prompt and waits until OpenCode logged one more main-agent request and its log went quiet. */
async function ask(session: TuiSession, text: string): Promise<string> {
  const before = modelsFromLog(session.openCodeLog()).length
  session.type(text)
  await Bun.sleep(300)
  session.send("Enter")
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline && modelsFromLog(session.openCodeLog()).length <= before) await Bun.sleep(1000)
  const used = modelsFromLog(session.openCodeLog())
  if (used.length <= before) throw new Error(`no request logged for "${text}" within 180s`)
  let size = -1
  while (Date.now() < deadline && session.openCodeLog().length !== size) {
    size = session.openCodeLog().length
    await Bun.sleep(5000)
  }
  return used.at(-1)?.model ?? ""
}

async function ready(session: TuiSession): Promise<void> {
  await session.waitFor(/ctrl\+p|commands|Ask anything/i, 180_000)
  await Bun.sleep(3000)
}

function save(evidence: string, name: string, session: TuiSession): void {
  writeFileSync(join(evidence, `${name}.txt`), session.capture())
}

async function main(): Promise<void> {
  const only = new Set((option("only") ?? "1,2,3,4,5").split(","))
  const plugin = option("plugin") ?? join(REPO, "dist/index.js")
  const evidence = join(REPO, ".omo/evidence/omo-models-tui", String(Date.now()))
  mkdirSync(evidence, { recursive: true })
  const results: Result[] = []
  const guard = () => {
    const free = availableMb()
    if (free !== undefined && free - TUI_COST_MB < RESERVE_MB) throw new Error(`stopping: ${free} MB available, ${RESERVE_MB} MB stay free for other work`)
  }

  if (only.has("1") || only.has("2") || only.has("3")) {
    guard()
    let session = await startTui({ plugin, name: "omo-models", configure: (sandbox) => setSisyphusChain(sandbox, [LING, PICKLE]) })
    const { sandbox, workdir } = session
    try {
      await ready(session)
      const first = await ask(session, "Reply with one word: one")
      save(evidence, "1a-startup", session)
      setSisyphusChain(sandbox, [NEMOTRON, PICKLE])
      await Bun.sleep(1500)
      const second = await ask(session, "Reply with one word: two")
      save(evidence, "1b-after-change", session)
      results.push({ name: "1 live change", pass: first === LING && second === NEMOTRON, detail: `startup ${first}, after saving ${NEMOTRON}: ${second}` })

      if (only.has("2")) {
        session.stop({ keepSandbox: true })
        setSisyphusChain(sandbox, [MIMO, PICKLE])
        guard()
        session = await startTui({ plugin, name: "omo-models", args: ["--continue"], reuse: { sandbox, workdir } })
        await ready(session)
        save(evidence, "2a-resumed", session)
        const resumed = await ask(session, "Reply with one word: three")
        save(evidence, "2b-resumed-answer", session)
        results.push({ name: "2 resumed session", pass: resumed === MIMO, detail: `old session on ${NEMOTRON}, today's primary ${MIMO}: ${resumed}` })
      }

      if (only.has("3")) {
        session.type("/models")
        await Bun.sleep(500)
        session.send("Enter")
        await Bun.sleep(2500)
        save(evidence, "3a-models-dialog", session)
        session.type(PICKLE)
        await Bun.sleep(1500)
        save(evidence, "3b-models-filtered", session)
        session.send("Enter")
        await Bun.sleep(2000)
        const picked = await ask(session, "Reply with one word: four")
        save(evidence, "3c-after-pick", session)
        results.push({ name: "3 /models pick respected", pass: picked === PICKLE, detail: `picked ${PICKLE} by hand: ${picked}` })
      }
    } finally {
      writeFileSync(join(evidence, "run1-opencode.log"), session.openCodeLog())
      writeFileSync(join(evidence, "run1-plugin.log"), pluginLog(sandbox))
      writeFileSync(join(evidence, "run1-models-used.json"), JSON.stringify(modelsFromLog(session.openCodeLog()), null, 2))
      session.stop()
    }
  }

  if (only.has("4")) {
    guard()
    const session = await startTui({ plugin, name: "omo-models", configure: (sandbox) => setSisyphusChain(sandbox, [RETIRED, NEMOTRON]) })
    try {
      await ready(session)
      save(evidence, "4a-startup-retired", session)
      const used = await ask(session, "Reply with one word: five")
      save(evidence, "4b-answer", session)
      results.push({ name: "4 retired configured model", pass: used === NEMOTRON, detail: `configured ${RETIRED} (deprecated) then ${NEMOTRON}: ${used}` })
    } finally {
      writeFileSync(join(evidence, "run4-opencode.log"), session.openCodeLog())
      writeFileSync(join(evidence, "run4-plugin.log"), pluginLog(session.sandbox))
      session.stop()
    }
  }

  if (only.has("5")) {
    guard()
    const session = await startTui({ plugin, name: "omo-models", configure: (sandbox) => setSisyphusChain(sandbox, [LING, PICKLE]) })
    try {
      await ready(session)
      const steps: Array<[string, string]> = [["/omo-models", "Choose models for an omo agent"], ["sisyphus", "sisyphus: primary model"], [MIMO, "for sisyphus\\?"], ["", "fallback 1"], [PICKLE, "for sisyphus\\?"], ["", "fallback 2"], ["Done", ""]]
      for (const [index, [text, next]] of steps.entries()) {
        if (text) session.type(text)
        await Bun.sleep(800)
        session.send("Enter")
        if (next) await session.waitFor(new RegExp(next), 20_000)
        save(evidence, `5-${index}-${text || "enter"}`, session)
      }
      await Bun.sleep(2500)
      const screen = session.capture()
      save(evidence, "5-final", session)
      const savedChain = readFileSync(join(session.sandbox.root, "home/.omo/omo.jsonc"), "utf8")
      const opened = /Select model/i.test(screen)
      const saved = savedChain.includes(`opencode/${MIMO}`)
      results.push({ name: "5 /omo-models saves and opens the model list", pass: opened && saved, detail: `chain saved: ${saved}; OpenCode model list opened: ${opened}` })
    } finally {
      writeFileSync(join(evidence, "run5-plugin.log"), pluginLog(session.sandbox))
      session.stop()
    }
  }

  writeFileSync(join(evidence, "results.json"), JSON.stringify(results, null, 2))
  for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}: ${result.detail}`)
  console.log(`evidence: ${evidence}`)
  process.exit(results.every((result) => result.pass) ? 0 : 1)
}

if (import.meta.main) await main()
