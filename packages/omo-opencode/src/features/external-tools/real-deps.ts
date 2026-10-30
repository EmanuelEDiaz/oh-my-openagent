import { execFile } from "node:child_process"

import { globalTypeScriptDirs, probeLanguageServer, resolveServerBinary, resolveTypeScript6 } from "@oh-my-opencode/lsp-core"

import type { CheckDeps } from "./check"

const VERSION_TIMEOUT_MS = 10_000

function runWithTimeout(argv: readonly string[]): Promise<{ exitCode: number; firstLine: string } | undefined> {
  const [command, ...args] = argv
  if (command === undefined) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(command, args, { timeout: VERSION_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error && (error as { killed?: boolean }).killed) return resolve(undefined)
      const exitCode = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0
      resolve({ exitCode, firstLine: `${stdout}\n${stderr}`.trim().split("\n")[0] ?? "" })
    })
  })
}

/** The real lookups: the same binary resolution as the language-server tools (PATH and the project's own bins). */
export function createCheckDeps(): CheckDeps {
  return {
    which: (command, projectDir) => resolveServerBinary([command], projectDir),
    run: runWithTimeout,
    probe: probeLanguageServer,
    resolveTypeScript6,
    globalTypeScriptDirs,
  }
}
