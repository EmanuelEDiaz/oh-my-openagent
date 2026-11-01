/**
 * Which `bash` commands must not run in the foreground (fork roadmap 0.8b): long-running installs, downloads, builds,
 * containers, servers and watchers go through `process_start`; commands that can kill OpenCode or the agent's own
 * shell are refused. Each match explains the alternative.
 */

export type CommandClass =
  | { readonly block: false; readonly kind?: undefined; readonly message?: undefined }
  | { readonly block: true; readonly kind: "long-running" | "self-kill" | "privileged" | "forced-git-identity"; readonly message: string }

const LONG_RUNNING: readonly RegExp[] = [
  // package installs
  /^(sudo\s+)?(npm|pnpm)\s+(i|install|ci|add)\b/,
  /^yarn(\s+(install|add)\b|\s*$)/,
  /^bun\s+(i|install|add)\b/,
  /^(python3?\s+-m\s+)?pip3?\s+install\b/,
  /^uv\s+(sync|add|pip\s+install)\b/,
  /^poetry\s+(install|add)\b/,
  /^cargo\s+install\b/,
  /^composer\s+(install|update|require)\b/,
  /^(sudo\s+)?apt(-get)?\s+(install|upgrade)\b/,
  /^(sudo\s+)?(dnf|yum|pacman|zypper)\s+(install|-S)\b/,
  /^brew\s+(install|upgrade)\b/,
  /^gem\s+install\b/,
  // downloads
  /^curl\b.*\s(-[a-zA-Z]*[oO]\b|--output\b|--remote-name\b)/,
  /^wget\b/,
  // containers
  /^(docker|podman)\s+(build|pull|run)\b/,
  /^(docker\s+compose|docker-compose|podman-compose)\s+(up|build|pull)\b/,
  // heavy builds
  /^\.?\/?gradlew?\s/,
  /^mvn\s/,
  // servers and watchers
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch|preview)\b/,
  /\s--watch\b/,
  /^(vite|nodemon|uvicorn|gunicorn|hypercorn)\b/,
  /^(npx\s+)?next\s+(dev|start)\b/,
  /^flask\s+run\b/,
  /^php\s+artisan\s+serve\b/,
  /^(bundle\s+exec\s+)?rails\s+(s|server)\b/,
  /^python3?\s+(-m\s+http\.server|manage\.py\s+runserver)\b/,
  /^tail\s+(-[a-zA-Z]*f|--follow)\b/,
  /^nohup\b/,
]

const SELF_KILL: readonly RegExp[] = [
  /^pkill\s+(.*\s)?-f\b/,
  /^pkill\s+(-\w+\s+)*(node|bun|opencode|bash|sh|zsh|fish|tmux|python3?)\b/,
  /^killall\b/,
  /^kill\s+(-\w+\s+)*(-1|0)\s*$/,
  /^tmux\s+kill-server\b/,
  /^taskkill\b.*\/IM\b/i,
  /^(pgrep|ps)\b.*\|\s*(xargs\s+)?kill\b/,
]

// Runs as root: passwordless sudo let the agent start a system service (fork incident H46).
const PRIVILEGED = /^(sudo|doas|pkexec|run0)\b|^su\s+(-\S+\s+)*-c\b/

// A git identity the agent picks instead of the repository's configured one (fork incident H50): more than one person
// commits on the user's machine, so a made-up or copied author is a real error.
const IDENTITY_ENV = /(^|\s)(export\s+)?GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)=/
const IDENTITY_FLAG = /\bgit\s+(-C\s+\S+\s+|-c\s+\S+\s+)*-c\s+user\.(name|email)=/
const AUTHOR_FLAG = /\bgit\s+(-C\s+\S+\s+|-c\s+\S+\s+)*commit\b.*\s--author(=|\s)/
// Setting it (a value follows), not reading it; a redirect such as `2>/dev/null` is not a value.
const IDENTITY_CONFIG = /\bgit\s+(-C\s+\S+\s+)*config\s+(--(local|global|system|worktree)\s+)?user\.(name|email)\s+(?!\d*>)\S/

function forcesGitIdentity(command: string): boolean {
  if (!/\bgit\b/.test(command)) return false
  return segments(command).some((part) =>
    IDENTITY_ENV.test(part) || IDENTITY_FLAG.test(part) || AUTHOR_FLAG.test(part) || IDENTITY_CONFIG.test(part))
}

// Only version or help flags: the tool prints and exits (fork incident H45).
const INFORMATIONAL = /^\S+(\s+(-v|-V|-version|--version|-h|-help|--help|version|help))+$/
const LOCAL_URL = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|\s|$)/
const ANY_URL = /\bhttps?:\/\/\S+/g

/** A segment that only asks for a version, or only talks to the app's own local server, is never long-running. */
function instant(part: string): boolean {
  const withoutRedirects = part.replace(/\s+\d*>>?&?\s*\S+/g, "").trim()
  if (INFORMATIONAL.test(withoutRedirects) && !/^(-v|-V)$/.test(withoutRedirects)) return true
  if (!/^(curl|wget)\b/.test(part)) return false
  const urls = part.match(ANY_URL) ?? []
  return urls.length > 0 && urls.every((url) => LOCAL_URL.test(`${url} `))
}

/** Splits on shell separators so `cd x && npm install` is judged by each part. */
function segments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\n/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function backgrounded(command: string): boolean {
  return /(^|[^&])&\s*$/.test(command.trim())
}

function identityVerdict(shown: string): CommandClass {
  return {
    block: true,
    kind: "forced-git-identity",
    message: [
      `Blocked: \`${shown}\` picks a git identity instead of the repository's configured one.`,
      "More than one person commits on this machine: never invent an author or copy another commit's,",
      "and do not work around this block (scripts, aliases, other tools).",
      "Commit with plain `git commit`; if it fails for lack of an identity, stop and ask the user which name and email to use",
      '(they can set it with `! git config user.name "<name>"` and `! git config user.email "<email>"`).',
      "If the user asked for this author, tell them to run the commit themselves, e.g. `! git commit --author=\"<name> <email>\" -m \"<message>\"`.",
    ].join(" "),
  }
}

/** A script the command runs (scripts.ts), judged for what cannot be dodged by moving it into a file. */
export function classifyScriptText(text: string, shown: string): CommandClass {
  return forcesGitIdentity(text) ? identityVerdict(shown) : { block: false }
}

export function classifyCommand(command: string): CommandClass {
  const trimmed = command.trim()
  // A kill pipeline (`pgrep -f x | xargs kill`) must be judged whole, before splitting.
  if (SELF_KILL.some((pattern) => pattern.test(trimmed)) || segments(trimmed).some((part) => SELF_KILL.some((pattern) => pattern.test(part)))) {
    return {
      block: true,
      kind: "self-kill",
      message: [
        `Blocked: \`${trimmed}\` can kill OpenCode, the agent's own shell or unrelated processes.`,
        "Stop a managed process with `process_stop <id>`; otherwise kill one known PID (`kill <pid>`, on Windows `taskkill /PID <pid> /T`)",
        "or free a port with `fuser -k <port>/tcp`. If none applies, ask the user.",
      ].join(" "),
    }
  }
  if (segments(trimmed).some((part) => PRIVILEGED.test(part))) {
    return {
      block: true,
      kind: "privileged",
      message: [
        `Blocked: \`${trimmed}\` runs as root. Root actions on the user's machine are theirs to take:`,
        "ask the user to run it themselves (they can type",
        `\`! ${trimmed}\` in the prompt) or find a way without root.`,
      ].join(" "),
    }
  }
  if (forcesGitIdentity(trimmed)) return identityVerdict(trimmed)
  const longRunning = backgrounded(trimmed)
    || segments(trimmed).some((part) => {
      const head = part.replace(/\s*\|.*$/, "")
      return !instant(head) && LONG_RUNNING.some((pattern) => pattern.test(head))
    })
  if (!longRunning) return { block: false }
  return {
    block: true,
    kind: "long-running",
    message: [
      `Blocked: \`${trimmed}\` is a long-running command (install, download, build, container, server or watcher).`,
      "Using `process_start` for it is mandatory: it runs in the background with a log and wakes you when it is done, so the session is not blocked or cut off.",
      `Example: process_start({ name: "<short name>", command: ${JSON.stringify(trimmed)}, wait_for: "exit" })`,
      '— for servers use wait_for: { pattern: "<ready text>" } or { port: <n> }.',
    ].join(" "),
  }
}
