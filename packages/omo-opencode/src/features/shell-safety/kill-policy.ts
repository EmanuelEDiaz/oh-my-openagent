/**
 * Kill only what the agent started (fork roadmap 0.21, entrega 1). Small models kill OpenCode, the user's terminal or
 * an unrelated server with `pkill -f node` or `kill $(pgrep …)`. Every command a line would run is read (see parse.ts)
 * and each kill is judged by its real targets: protected processes (OpenCode, its ancestors, its group and session,
 * PID 1, -1, 0) are never killed; a literal PID is allowed only when the agent started it (the managed-process
 * registry, or a process in the group of one); name patterns and targets computed at run time are refused.
 */
import { parseShell, type ShellCommand } from "./parse"

export type KillContext = {
  readonly protectedPids: ReadonlySet<number>
  readonly protectedGroups: ReadonlySet<number>
  /** PIDs the agent started (process_start); they lead their own process group. */
  readonly ownedPids: ReadonlySet<number>
  /** Process group of a live PID, when it can be read. */
  readonly groupOf: (pid: number) => number | undefined
}

export type KillVerdict = { readonly decision: "allow" } | { readonly decision: "deny"; readonly message: string }

const KILL_WORD = /\b(?:kill|pkill|killall|taskkill|Stop-Process|fuser|kill-server)\b/i

const ADVICE = "Stop a process you started with `process_stop <id>` (see `process_list`). To free a port, find its owner (`lsof -i :PORT` or `ss -ltnp`) and ask the user before stopping it; if you still need this, ask the user with the question tool."

function deny(reason: string): KillVerdict {
  return { decision: "deny", message: `Blocked: ${reason}. ${ADVICE}` }
}

function judgeTarget(target: number, group: boolean, ctx: KillContext): string | undefined {
  if (!group && (target === 0 || target === -1 || target === 1)) return `PID ${target} means "every process" or init`
  if (group) {
    if (ctx.protectedGroups.has(target)) return `process group ${target} contains OpenCode`
    return ctx.ownedPids.has(target) ? undefined : `process group ${target} was not started by you`
  }
  if (ctx.protectedPids.has(target)) return `PID ${target} is OpenCode, one of its parents or the user's terminal`
  if (ctx.ownedPids.has(target)) return undefined
  const pgid = ctx.groupOf(target)
  if (pgid !== undefined && ctx.ownedPids.has(pgid)) return undefined
  return `PID ${target} was not started by you`
}

/** `kill [-SIG | -s SIG | -n N] [--] targets…` */
function judgePosixKill(command: ShellCommand, ctx: KillContext): KillVerdict {
  const args = command.argv.slice(1)
  if (args.includes("-l") || args.includes("-L")) return { decision: "allow" }
  if (command.dynamic) return deny(`\`${command.argv.join(" ")}\` picks its target at run time, so it cannot be checked`)
  const targets: string[] = []
  let afterDashes = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string
    if (!afterDashes && arg === "--") {
      afterDashes = true
      continue
    }
    if (!afterDashes && (arg === "-s" || arg === "-n")) {
      index++
      continue
    }
    if (!afterDashes && /^-(?:[A-Za-z]+|\d+)$/.test(arg) && targets.length === 0 && index < args.length - 1) continue
    targets.push(arg)
  }
  if (targets.length === 0) return deny("`kill` without a target")
  for (const target of targets) {
    if (/^%\S*$/.test(target)) continue
    if (!/^-?\d+$/.test(target)) return deny(`\`kill ${target}\` does not name a PID`)
    const value = Number(target)
    const reason = value < -1 ? judgeTarget(-value, true, ctx) : judgeTarget(value, false, ctx)
    if (reason) return deny(reason)
  }
  return { decision: "allow" }
}

function optionValue(argv: readonly string[], names: readonly string[]): string | undefined {
  const index = argv.findIndex((arg) => names.some((name) => arg.toLowerCase() === name.toLowerCase()))
  return index === -1 ? undefined : argv[index + 1]
}

function judgeCommand(command: ShellCommand, ctx: KillContext): KillVerdict | undefined {
  const name = (command.argv[0] ?? "").replace(/^.*[/\\]/, "").replace(/\.exe$/i, "")
  const lower = name.toLowerCase()
  if (lower === "kill") return judgePosixKill(command, ctx)
  if (lower === "pkill" || lower === "killall" || lower === "skill" || lower === "slay") {
    return deny(`\`${command.argv.join(" ")}\` kills by name, which can hit OpenCode, the user's shell or their servers`)
  }
  if (lower === "fuser" && command.argv.some((arg) => /^-\w*k/.test(arg))) {
    return deny(`\`${command.argv.join(" ")}\` kills whatever holds that file or port, which may be the user's own server`)
  }
  if (lower === "taskkill" || lower === "stop-process") {
    if (command.argv.some((arg) => /^[/-](?:im|name|processname)$/i.test(arg))) return deny(`\`${command.argv.join(" ")}\` kills by name`)
    const pid = optionValue(command.argv, ["/PID", "-PID", "-Id"])
    if (pid === undefined || command.dynamic) return deny(`\`${command.argv.join(" ")}\` has no fixed PID`)
    if (!/^\d+$/.test(pid)) return deny(`\`${pid}\` is not a PID`)
    const reason = judgeTarget(Number(pid), false, ctx)
    return reason ? deny(reason) : { decision: "allow" }
  }
  if (lower === "tmux" && command.argv.includes("kill-server")) {
    const privateServer = command.argv.includes("-L") || command.argv.includes("-S")
    return privateServer ? { decision: "allow" } : deny("`tmux kill-server` closes the user's tmux sessions")
  }
  return undefined
}

/** Undefined when the line kills nothing; otherwise the verdict for its riskiest kill. */
export function judgeKills(line: string, ctx: KillContext): KillVerdict | undefined {
  const parsed = parseShell(line)
  if (!parsed.ok && KILL_WORD.test(line)) return deny(`\`${line.trim()}\` cannot be read reliably and it kills processes`)
  let verdict: KillVerdict | undefined
  for (const command of parsed.commands) {
    const judged = judgeCommand(command, ctx)
    if (judged?.decision === "deny") return judged
    verdict ??= judged
  }
  return verdict
}
