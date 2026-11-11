/**
 * Test credentials end to end (fork roadmap 0.21, entrega 2): passwords the agent sets in commands or writes into
 * `.env`/compose/`.sql` files are saved; `${OMO_SECRET:name}` in a command is filled in through the environment;
 * saved values are blanked in every tool output; and they never reach git (no `git add -f .omo/secrets`, no commit
 * whose staged changes contain one).
 */
import { readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

import { parseShell } from "../shell-safety/parse"
import { captureCredentials } from "./capture"
import { injectSecrets, redactSecrets } from "./inject"
import type { CredentialStore } from "./store"

export type CredentialsGuardDeps = {
  readonly directory: string
  readonly store: CredentialStore
  /** `git diff --cached` (plus unstaged changes for `commit -a`) of the project. */
  readonly stagedDiff: (includeUnstaged: boolean) => string
}

const SHELL_TOOLS = new Set(["bash", "interactive_bash"])
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "hashline_edit"])
const CREDENTIAL_FILE = /(?:^|[/\\])(?:\.env(?:\.[\w.-]+)?|(?:docker-)?compose[\w.-]*\.ya?ml|[\w.-]+\.sql)$/i

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function createCredentialsGuard(deps: CredentialsGuardDeps) {
  const envByCall = new Map<string, Record<string, string>>()
  const rel = (path: string) => relative(deps.directory, path) || path

  function commitLeaks(includeUnstaged: boolean): string[] {
    const secrets = deps.store.redactable()
    if (secrets.length === 0) return []
    const leaks: string[] = []
    let file = ""
    for (const line of deps.stagedDiff(includeUnstaged).split("\n")) {
      if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (?:b\/)?/, "")
      else if (line.startsWith("+")) for (const secret of secrets) if (line.includes(secret.value)) leaks.push(`${secret.name} in ${file}`)
    }
    return [...new Set(leaks)]
  }

  function save(text: string, origin: string, sessionID: string): string[] {
    const notes: string[] = []
    for (const found of captureCredentials(text, origin)) {
      const result = deps.store.save({ ...found, session: sessionID })
      if (result !== "unchanged") notes.push(`[credentials] Saved the test password as ${found.name} (from ${found.origin}). Reuse it with \${OMO_SECRET:${found.name}} or credential({ action: "get", name: "${found.name}" }).`)
    }
    return notes
  }

  return {
    /** Throws to refuse the command; may rewrite `args.command`. */
    async before(tool: string, _sessionID: string, callID: string, args: Record<string, unknown>): Promise<void> {
      if (!SHELL_TOOLS.has(tool.toLowerCase())) return
      const key = args["command"] !== undefined ? "command" : "tmux_command"
      const command = str(args[key])
      if (!command) return

      for (const entry of parseShell(command).commands) {
        if ((entry.argv[0] ?? "").replace(/^.*\//, "") !== "git") continue
        const sub = entry.argv.find((arg, index) => index > 0 && !arg.startsWith("-") && entry.argv[index - 1] !== "-C" && entry.argv[index - 1] !== "-c")
        if (sub === "add" && entry.argv.some((arg) => arg === "-f" || arg === "--force") && entry.argv.some((arg) => /\.omo[/\\]secrets/.test(arg))) {
          throw new Error("[credentials] BLOCKED: .omo/secrets holds the saved test passwords and must never be committed.")
        }
        if (sub === "commit") {
          const leaks = commitLeaks(entry.argv.some((arg) => /^-\w*a/.test(arg) || arg === "--all"))
          if (leaks.length > 0) {
            throw new Error(`[credentials] BLOCKED: the commit would include saved passwords: ${leaks.join(", ")}. Read them from the environment or a git-ignored file instead, and unstage the change.`)
          }
        }
      }

      const injected = injectSecrets(command, (name) => deps.store.get(name)?.value)
      if (injected.missing.length > 0) {
        const names = deps.store.list().map((entry) => entry.name)
        throw new Error(`[credentials] Unknown secret(s): ${injected.missing.join(", ")}. ${names.length ? `Saved: ${names.join(", ")}.` : "None saved yet."}`)
      }
      if (Object.keys(injected.env).length === 0) return
      args[key] = injected.command
      envByCall.set(callID, injected.env)
    },

    /** The values for this call's shell, once. */
    shellEnv(callID: string | undefined): Record<string, string> {
      if (!callID) return {}
      const env = envByCall.get(callID) ?? {}
      envByCall.delete(callID)
      return env
    },

    /** Blanks saved values in the output and saves passwords the agent just set. */
    async after(input: { tool: string; sessionID: string; callID: string; args: Record<string, unknown> }, output: { output?: string }): Promise<void> {
      const tool = input.tool.toLowerCase()
      envByCall.delete(input.callID)
      const notes: string[] = []
      if (SHELL_TOOLS.has(tool)) notes.push(...save(str(input.args["command"]) ?? str(input.args["tmux_command"]) ?? "", "command", input.sessionID))
      if (WRITE_TOOLS.has(tool)) {
        const filePath = str(input.args["filePath"]) ?? str(input.args["file_path"]) ?? str(input.args["path"])
        const targets = filePath ? [filePath] : [...(str(input.args["patchText"]) ?? "").matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map((match) => (match[1] ?? "").trim())
        for (const target of targets) {
          const path = isAbsolute(target) ? target : resolve(deps.directory, target)
          if (!CREDENTIAL_FILE.test(path)) continue
          let text = ""
          try {
            text = readFileSync(path, "utf8")
          } catch {
            continue
          }
          notes.push(...save(text, rel(path), input.sessionID))
        }
      }
      const secrets = deps.store.redactable()
      if (typeof output.output === "string" && secrets.length > 0) output.output = redactSecrets(output.output, secrets)
      if (notes.length > 0) output.output = `${output.output ?? ""}\n\n${notes.join("\n")}`
    },
  }
}

export type CredentialsGuard = ReturnType<typeof createCredentialsGuard>
