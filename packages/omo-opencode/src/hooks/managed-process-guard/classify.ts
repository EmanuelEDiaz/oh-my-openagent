/**
 * Which `bash` commands must not run in the foreground (fork roadmap 0.8b): long-running installs, downloads, builds,
 * containers, servers and watchers go through `process_start`; commands that can kill OpenCode or the agent's own
 * shell are refused. Each match explains the alternative.
 */

export type CommandClass =
  | { readonly block: false; readonly kind?: undefined; readonly message?: undefined }
  | { readonly block: true; readonly kind: "long-running" | "self-kill"; readonly message: string }

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
  const longRunning = backgrounded(trimmed)
    || segments(trimmed).some((part) => LONG_RUNNING.some((pattern) => pattern.test(part.replace(/\s*\|.*$/, ""))))
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
