/**
 * Shell safety guard (fork roadmap 0.21, entrega 1). Before each shell command: kills are judged by their real targets
 * and destructive commands need the user's approval for that exact command. After a database password failure,
 * destroying is refused outright: small models that forget a password they set tend to drop the database or the volume
 * to start over, and the user's data goes with it. Then the only ways forward are the fixed options (reuse the saved
 * password, change it without losing data, destroy after a backup, cancel), and "destroy" needs a backup that
 * succeeded after the failure. Approvals and the lock belong to the top-level session, so subagents share them.
 */
import { createHash } from "node:crypto"

import { destructiveFindings, type DestructiveFinding } from "./destructive-policy"
import { judgeKills, type KillContext } from "./kill-policy"
import { parseShell } from "./parse"

export type ShellSafetyDeps = {
  readonly directory: string
  readonly readFile: (absolutePath: string) => string | undefined
  readonly killContext: () => KillContext
  readonly rootOf: (sessionID: string) => Promise<string>
}

type RootState = { approved: Set<string>; destroyAfterBackup: Set<string>; passwordFailureAt?: number; backupAt?: number }

const SHELL_TOOLS = new Set(["bash", "interactive_bash"])
const PASSWORD_FAILURE = /password authentication failed|Access denied for user|\b28P01\b|Login failed for user|WRONGPASS|NOAUTH Authentication required|Authentication failed\.? \(|FATAL:\s+password/i
const ALLOW_ANSWER = /Allow destructive command #([0-9a-f]{8})/i
const BACKUP_ANSWER = /Destroy after a backup #([0-9a-f]{8})/i
const BACKUP_TOOLS = new Set(["pg_dump", "pg_dumpall", "mysqldump", "mariadb-dump", "mongodump", "pg_basebackup"])

/** Same command, same fingerprint: whitespace does not matter, any other change does. */
export function commandFingerprint(command: string): string {
  return createHash("sha256").update(command.trim().replace(/\s+/g, " ")).digest("hex").slice(0, 8)
}

function isBackup(command: string): boolean {
  return parseShell(command).commands.some((entry) => {
    const name = (entry.argv[0] ?? "").replace(/^.*\//, "")
    // Also inside `docker exec db pg_dump …` / `kubectl exec … -- mysqldump …`.
    if (entry.argv.some((arg) => BACKUP_TOOLS.has(arg.replace(/^.*\//, "")))) return true
    if (name === "redis-cli" && entry.argv.includes("--rdb")) return true
    if (name === "sqlite3" && entry.argv.some((arg) => /^\.backup\b/.test(arg))) return true
    if (name === "tar" && entry.argv.some((arg) => /^-?\w*c/.test(arg))) return true
    return false
  })
}

function commandOf(args: Record<string, unknown>): string | undefined {
  const command = args["command"] ?? args["tmux_command"]
  return typeof command === "string" ? command : undefined
}

export function createShellSafetyGuard(deps: ShellSafetyDeps) {
  const states = new Map<string, RootState>()
  const stateOf = (root: string): RootState => {
    let state = states.get(root)
    if (!state) {
      state = { approved: new Set(), destroyAfterBackup: new Set() }
      states.set(root, state)
    }
    return state
  }

  function askMessage(findings: readonly DestructiveFinding[], fingerprint: string): string {
    return [
      "[shell-safety] BLOCKED: this command would destroy data:",
      ...findings.map((finding) => `- ${finding.what}`),
      "Nothing destructive runs without the user's approval. Ask the user with the question tool, saying exactly what will be lost, with the options",
      `"Allow destructive command #${fingerprint}" and "Cancel". If they allow it, run exactly the same command again.`,
    ].join("\n")
  }

  function lockedMessage(findings: readonly DestructiveFinding[], fingerprint: string): string {
    return [
      "[shell-safety] BLOCKED: a database password just failed, and this command would destroy data:",
      ...findings.map((finding) => `- ${finding.what}`),
      "Destroying a database to get past a forgotten password loses the user's data. Find the password first: credential({ action: \"list\" }) has the test passwords saved for this project; also .env, docker-compose.yml, config files, the README.",
      "Then ask the user with the question tool, with these options in this order:",
      '1. "Reuse the saved password" (say where you found it)',
      '2. "Change the password without losing data" (e.g. ALTER USER … PASSWORD)',
      `3. "Destroy after a backup #${fingerprint}" (back it up first: pg_dump / mysqldump / export the volume)`,
      '4. "Cancel"',
    ].join("\n")
  }

  return {
    /** Throws to refuse the command; the message is what the model sees. */
    async before(tool: string, sessionID: string, args: Record<string, unknown>): Promise<void> {
      if (!SHELL_TOOLS.has(tool.toLowerCase())) return
      const command = commandOf(args)
      if (!command) return
      const kill = judgeKills(command, deps.killContext())
      if (kill?.decision === "deny") throw new Error(`[shell-safety] ${kill.message}`)

      const findings = destructiveFindings(command, { directory: deps.directory, readFile: deps.readFile }).filter((finding) => !finding.test)
      if (findings.length === 0) return
      const fingerprint = commandFingerprint(command)
      const state = stateOf(await deps.rootOf(sessionID))
      if (state.passwordFailureAt !== undefined) {
        if (!state.destroyAfterBackup.has(fingerprint)) throw new Error(lockedMessage(findings, fingerprint))
        if (state.backupAt === undefined || state.backupAt < state.passwordFailureAt) {
          throw new Error(`[shell-safety] BLOCKED: the user chose "destroy after a backup", but no backup has succeeded since the password failed. Run the backup (pg_dump / mysqldump / export the volume), check it worked, then run this command again; back it up first.`)
        }
        return
      }
      if (!state.approved.has(fingerprint)) throw new Error(askMessage(findings, fingerprint))
    },

    /** Returns a note to append to the tool output (empty when there is nothing to say). */
    async after(input: { tool: string; sessionID: string; args: Record<string, unknown> }, output: { output?: string; metadata?: Record<string, unknown> }): Promise<string> {
      const tool = input.tool.toLowerCase()
      const root = await deps.rootOf(input.sessionID)
      if (tool === "question") {
        const answers = Array.isArray(output.metadata?.["answers"]) ? (output.metadata?.["answers"] as unknown[]).flat() : []
        for (const answer of answers) {
          if (typeof answer !== "string") continue
          const allow = ALLOW_ANSWER.exec(answer)?.[1]
          if (allow) stateOf(root).approved.add(allow)
          const destroy = BACKUP_ANSWER.exec(answer)?.[1]
          if (destroy) stateOf(root).destroyAfterBackup.add(destroy)
        }
        return ""
      }
      if (!SHELL_TOOLS.has(tool)) return ""
      const command = commandOf(input.args) ?? ""
      const text = output.output ?? ""
      if (PASSWORD_FAILURE.test(text)) {
        stateOf(root).passwordFailureAt = Date.now()
        return "[shell-safety] A database password failed. Do not drop, reset or recreate the database or its volume to get around it: get the saved password with credential({ action: \"list\" }) (or look in .env / docker-compose.yml), or ask the user."
      }
      const exit = output.metadata?.["exit"]
      if (exit === 0 && isBackup(command)) stateOf(root).backupAt = Date.now()
      return ""
    },

    forgetSession(sessionID: string): void {
      states.delete(sessionID)
    },
  }
}

export type ShellSafetyGuard = ReturnType<typeof createShellSafetyGuard>
