#!/usr/bin/env bun
/**
 * Real-TUI QA of fork step 0.25 (external tools). In an isolated XDG sandbox, the real OpenCode TUI opens a TypeScript
 * project twice:
 *   missing  — PATH without any folder that holds typescript-language-server: the startup toast must name it;
 *   present  — the normal PATH: no toast, and the plugin log says the server connects.
 * Then `oh-my-openagent doctor` runs from source in the "missing" environment and must report it with the @6 command.
 *
 *   bun script/fork/qa/external-tools-tui.ts --plugin dist-qa/ext/index.js [--evidence .omo/evidence/x]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"

import { createSandbox, destroySandbox, onStopSignal, prepareWorkdir, saveServerLogs, type Sandbox } from "../bench/sandbox"
import { startTui, type TuiSession } from "./tui-driver"

const REPO = join(import.meta.dir, "../../..")
const SERVER = "typescript-language-server"

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

/** PATH without the folders that hold the TypeScript server (mise shims included). */
function pathWithoutServer(): string {
  return (process.env.PATH ?? "").split(delimiter).filter((dir) => dir && !existsSync(join(dir, SERVER))).join(delimiter)
}

function typescriptProject(sandbox: Sandbox, name: string): string {
  const workdir = prepareWorkdir(sandbox, join(REPO, "script/fork/bench/fixtures/fix-integrity/paginate"), name)
  if (!existsSync(join(workdir, "package.json"))) writeFileSync(join(workdir, "package.json"), JSON.stringify({ name, type: "module" }))
  return workdir
}

const pluginLog = (sandbox: Sandbox) => {
  const file = join(sandbox.root, "tmp/oh-my-opencode.log")
  return existsSync(file) ? readFileSync(file, "utf8") : ""
}

type Check = { name: string; pass: boolean; detail?: string }

async function scenario(plugin: string, name: string, path: string | undefined, evidence: string): Promise<{ checks: Check[]; screen: string; log: string }> {
  const base = createSandbox(join(process.env.TMPDIR ?? "/tmp", `omo-qa-ext-${name}-${process.pid}-${Date.now()}`), plugin)
  const sandbox: Sandbox = path === undefined ? base : { ...base, env: { ...base.env, PATH: path } }
  const workdir = typescriptProject(sandbox, name)
  let session: TuiSession | undefined
  const stopped = onStopSignal(() => {
    session?.stop()
    destroySandbox(sandbox)
  })
  try {
    session = await startTui({ plugin, name, reuse: { sandbox, workdir } })
    await session.waitFor(/ctrl\+p|commands|Ask anything/i, 180_000)
    // The check runs 4 s after the plugin loads; with the TUI idle the notice goes out at most 30 s later and stays
    // 20 s. With everything working there is no notice: wait for the check, then the same window.
    let screen = ""
    const deadline = Date.now() + 70_000
    while (Date.now() < deadline) {
      screen = session.capture()
      if (/Herramientas externas|no está instalado|no conecta/.test(screen)) break
      await Bun.sleep(1000)
    }
    const log = pluginLog(sandbox)
    const line = log.split("\n").find((entry) => entry.includes("[external-tools] startup check")) ?? ""
    const toast = /Herramientas externas|no está instalado|no conecta/.test(screen)
    const checks =
      path === undefined
        ? [check("the startup check ran", line !== "", line.slice(0, 200)), check("the TypeScript server connects", /typescript-language-server:connects/.test(line)), check("no toast", !toast)]
        : [check("the startup check ran", line !== "", line.slice(0, 200)), check("the TypeScript server is missing", /typescript-language-server:missing/.test(line)), check("the TUI shows the toast naming it", toast && /TypeScript/.test(screen))]
    return { checks, screen, log: line }
  } finally {
    stopped()
    session?.stop({ keepSandbox: true })
    saveServerLogs(sandbox, join(evidence, `${name}-logs`))
    destroySandbox(sandbox)
  }
}

const check = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, ...(detail ? { detail } : {}) })

async function doctorWithoutServer(): Promise<Check[]> {
  const project = join(process.env.TMPDIR ?? "/tmp", `omo-qa-ext-doctor-${process.pid}`)
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, "package.json"), "{}")
  const result = Bun.spawnSync(["bun", join(REPO, "packages/omo-opencode/src/cli/index.ts"), "doctor", "--verbose"], { cwd: project, env: { ...process.env, PATH: pathWithoutServer() } })
  const out = `${result.stdout.toString()}${result.stderr.toString()}`
  return [
    check("doctor lists the TypeScript server as not installed", /TypeScript language server.*not installed/.test(out)),
    check("doctor gives the command pinned to version 6", /typescript-language-server@6 typescript@6/.test(out)),
    check("doctor says how to keep it across Node upgrades", /postinstall/.test(out)),
  ]
}

async function main(): Promise<void> {
  const plugin = join(REPO, option("plugin", "dist-qa/ext/index.js"))
  const evidence = join(REPO, option("evidence", ".omo/evidence/20261021-external-tools/tui"))
  mkdirSync(evidence, { recursive: true })
  const report = join(evidence, `qa-${Date.now()}.jsonl`)
  let failed = 0
  const runs: Array<[string, () => Promise<{ checks: Check[]; screen?: string; log?: string }>]> = [
    ["missing", () => scenario(plugin, "missing", pathWithoutServer(), evidence)],
    ["present", () => scenario(plugin, "present", undefined, evidence)],
    ["doctor", async () => ({ checks: await doctorWithoutServer() })],
  ]
  const only = option("only", "").split(",").filter(Boolean)
  for (const [name, run] of runs.filter(([name]) => only.length === 0 || only.includes(name))) {
    const started = Date.now()
    const result = await run().catch((error) => ({ checks: [check("scenario ran", false, error instanceof Error ? error.message : String(error))] }))
    const pass = result.checks.every((entry) => entry.pass)
    if (!pass) failed++
    appendFileSync(report, `${JSON.stringify({ scenario: name, pass, seconds: Math.round((Date.now() - started) / 1000), ...result })}\n`)
    console.log(`${name}: ${pass ? "PASS" : "FAIL"}`)
    for (const entry of result.checks) console.log(`  ${entry.pass ? "ok  " : "FAIL"} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`)
  }
  console.log(`report: ${report}`)
  process.exit(failed === 0 ? 0 : 1)
}

await main()
