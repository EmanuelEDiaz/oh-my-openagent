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
import { availableMb, modelsByUserMessage, startTui, type TuiSession, type UserMessageModel } from "./tui-driver"

const REPO = join(import.meta.dir, "../../..")
/** RAM kept free for the user's other work; OMO_QA_RESERVE_MB overrides it when the user agrees to less. */
const RESERVE_MB = Number(process.env.OMO_QA_RESERVE_MB ?? 3072)
const TUI_COST_MB = 1024

/** A free model Zen lists that is never one of the chains below: a /models pick of it is deliberate. */
const MANUAL = "nemotron-3-ultra-free"
/** How OpenCode's model dialog shows it (its search matches display names). */
const MANUAL_LABEL = "Nemotron 3 Ultra"
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
const loopsDone = (log: string) => log.split("\n").filter((line) => line.includes('message="exiting loop"')).length

/**
 * Sends a prompt and returns the model OpenCode used for THAT message (see modelsByUserMessage), then waits until
 * OpenCode finished the turn, so the next prompt is not queued behind it.
 */
async function ask(session: TuiSession, text: string): Promise<string> {
  const before = modelsByUserMessage(session.openCodeLog()).length
  const loopsBefore = loopsDone(session.openCodeLog())
  session.type(text)
  await Bun.sleep(300)
  session.send("Enter")
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline && modelsByUserMessage(session.openCodeLog()).length <= before) await Bun.sleep(1000)
  const used = modelsByUserMessage(session.openCodeLog())
  if (used.length <= before) throw new Error(`no request logged for "${text}" within 240s`)
  while (Date.now() < deadline && loopsDone(session.openCodeLog()) <= loopsBefore) await Bun.sleep(1000)
  const turn = used[before] as UserMessageModel
  if (turn.error) console.log(`note: "${text}" on ${turn.model} hit a provider error (${turn.error}); the model choice is what is checked`)
  return turn.model
}

async function ready(session: TuiSession): Promise<void> {
  await session.waitFor(/ctrl\+p|commands|Ask anything/i, 180_000)
  // OpenCode drops a plugin that fails to import without a word in its log: check the server half really loaded,
  // or every "model used" below would be OpenCode's default agent and the test would blame the fix.
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && !pluginLog(session.sandbox).includes("[tool-registry] Built tool registry")) await Bun.sleep(1000)
  if (!pluginLog(session.sandbox).includes("[tool-registry] Built tool registry")) throw new Error("the plugin's server half did not load (no tool registry in its log): check that the dist imports, e.g. that skills/ sits next to index.js")
  await Bun.sleep(2000)
}

function save(evidence: string, name: string, session: TuiSession): void {
  writeFileSync(join(evidence, `${name.replace(/[^\w.-]+/g, "_")}.txt`), session.capture())
}

/** Opens OpenCode's own model dialog; a toast or a late keystroke can swallow the first try. */
async function openModelDialog(session: TuiSession): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    session.send("Escape")
    await Bun.sleep(500)
    session.type("/models")
    await Bun.sleep(800)
    session.send("Enter")
    try {
      await session.waitFor(/Select model/, 10_000)
      return
    } catch {
      session.send("C-u")
    }
  }
  throw new Error("OpenCode's model dialog (/models) did not open")
}

async function main(): Promise<void> {
  const only = new Set((option("only") ?? "1,2,3,4,5").split(","))
  const plugin = option("plugin") ?? join(REPO, "dist/index.js")
  const evidence = join(REPO, ".omo/evidence/omo-models-tui", String(Date.now()))
  mkdirSync(evidence, { recursive: true })
  const results: Result[] = []
  // Memory freed by the previous OpenCode takes a few seconds to come back: wait up to 2 minutes before giving up.
  const guard = async () => {
    const deadline = Date.now() + 120_000
    let free = availableMb()
    while (free !== undefined && free - TUI_COST_MB < RESERVE_MB && Date.now() < deadline) {
      await Bun.sleep(3000)
      free = availableMb()
    }
    if (free !== undefined && free - TUI_COST_MB < RESERVE_MB) throw new Error(`stopping: ${free} MB available, ${RESERVE_MB} MB stay free for other work`)
  }

  if (only.has("1") || only.has("2") || only.has("3")) {
    await guard()
    let session = await startTui({ plugin, name: "omo-models", configure: (sandbox) => setSisyphusChain(sandbox, [PICKLE, NEMOTRON]) })
    const { sandbox, workdir } = session
    try {
      await ready(session)
      const first = await ask(session, "Reply with one word: one")
      save(evidence, "1a-startup", session)
      setSisyphusChain(sandbox, [NEMOTRON, PICKLE])
      await Bun.sleep(1500)
      const second = await ask(session, "Reply with one word: two")
      save(evidence, "1b-after-change", session)
      results.push({ name: "1 live change", pass: first === PICKLE && second === NEMOTRON, detail: `startup ${first}, after saving ${NEMOTRON}: ${second}` })

      if (only.has("2")) {
        session.stop({ keepSandbox: true })
        setSisyphusChain(sandbox, [MIMO, PICKLE])
        await guard()
        session = await startTui({ plugin, name: "omo-models", args: ["--continue"], reuse: { sandbox, workdir } })
        await ready(session)
        save(evidence, "2a-resumed", session)
        const resumed = await ask(session, "Reply with one word: three")
        save(evidence, "2b-resumed-answer", session)
        results.push({ name: "2 resumed session", pass: resumed === MIMO, detail: `old session on ${NEMOTRON}, today's primary ${MIMO}: ${resumed}` })
      }

      if (only.has("3")) {
        await openModelDialog(session)
        save(evidence, "3a-models-dialog", session)
        session.type(MANUAL_LABEL)
        await Bun.sleep(1500)
        save(evidence, "3b-models-filtered", session)
        session.send("Enter")
        await Bun.sleep(2000)
        if (/Select model/.test(session.capture())) throw new Error(`OpenCode's model dialog is still open: "${MANUAL_LABEL}" was not found in it`)
        const picked = await ask(session, "Reply with one word: four")
        save(evidence, "3c-after-pick", session)
        results.push({ name: "3 /models pick respected", pass: picked === MANUAL, detail: `picked ${MANUAL} by hand: ${picked}` })
      }
    } catch (error) {
      // One broken case must not hide the results of the others.
      results.push({ name: "cases 1-3", pass: false, detail: `error: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      writeFileSync(join(evidence, "run1-opencode.log"), session.openCodeLog())
      writeFileSync(join(evidence, "run1-plugin.log"), pluginLog(sandbox))
      writeFileSync(join(evidence, "run1-models-used.json"), JSON.stringify(modelsByUserMessage(session.openCodeLog()), null, 2))
      session.stop()
    }
  }

  if (only.has("4")) {
    await guard()
    const session = await startTui({ plugin, name: "omo-models", configure: (sandbox) => setSisyphusChain(sandbox, [RETIRED, NEMOTRON]) })
    try {
      await ready(session)
      save(evidence, "4a-startup-retired", session)
      const used = await ask(session, "Reply with one word: five")
      save(evidence, "4b-answer", session)
      results.push({ name: "4 retired configured model", pass: used === NEMOTRON, detail: `configured ${RETIRED} (deprecated) then ${NEMOTRON}: ${used}` })
    } catch (error) {
      // One broken case must not hide the results of the others.
      results.push({ name: "4 retired configured model", pass: false, detail: `error: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      writeFileSync(join(evidence, "run4-opencode.log"), session.openCodeLog())
      writeFileSync(join(evidence, "run4-plugin.log"), pluginLog(session.sandbox))
      session.stop()
    }
  }

  if (only.has("5")) {
    await guard()
    const session = await startTui({ plugin, name: "omo-models", configure: (sandbox) => setSisyphusChain(sandbox, [PICKLE, NEMOTRON]) })
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
    } catch (error) {
      // One broken case must not hide the results of the others.
      results.push({ name: "5 /omo-models saves and opens the model list", pass: false, detail: `error: ${error instanceof Error ? error.message : String(error)}` })
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
