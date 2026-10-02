import { describe, expect, test } from "bun:test"

import { classifyCommand } from "./classify"

const blocked = (command: string) => classifyCommand(command).block
const kind = (command: string) => classifyCommand(command).kind

describe("long-running commands must use process_start (fork 0.8b)", () => {
  test.each([
    "npm install", "npm i lodash", "npm ci", "pnpm add zod", "yarn", "yarn install", "bun install", "bun add x",
    "pip install requests", "python -m pip install -r requirements.txt", "uv sync", "poetry install",
    "cargo install ripgrep", "composer install", "sudo apt-get install -y jq", "brew install sg",
    "curl -O https://x/y.tar.gz", "curl -L -o out.zip https://x", "wget https://x/file",
    "docker build -t x .", "docker pull node", "docker compose up", "docker-compose up -d",
    "npm run dev", "pnpm dev", "yarn start", "bun run watch", "vite", "next dev", "nodemon app.js",
    "uvicorn app:app --reload", "flask run", "php artisan serve", "python -m http.server", "tail -f log.txt",
    "npm run build -- --watch", "cd web && npm install", "npm test & ", "nohup ./server.sh",
    "./gradlew build", "mvn package",
  ])("blocks %s", (command) => {
    expect(blocked(command)).toBe(true)
    expect(kind(command)).toBe("long-running")
  })

  test.each([
    "npm test", "bun test src/a.test.ts", "pytest -q", "go test ./...", "git status", "ls -la", "cat package.json",
    "npm run lint", "tsc --noEmit", "curl -s https://api.x/health", "echo npm install", "grep -r 'npm install' docs",
    "docker ps", "npm ls", "pip list",
  ])("allows %s", (command) => {
    expect(blocked(command)).toBe(false)
  })

  test("the message says how to run it with process_start", () => {
    const result = classifyCommand("cd web && npm install")
    expect(result.message).toContain("process_start")
    expect(result.message).toContain("npm install")
  })
})

describe("self-destructive kill commands are blocked (fork 0.8b)", () => {
  test.each([
    "pkill -f mock-provider.ts", "pkill node", "killall bun", "killall -9 opencode", "kill -9 -1", "kill 0",
    "tmux kill-server", "taskkill /IM node.exe /F", "pgrep -f server | xargs kill",
  ])("blocks %s", (command) => {
    expect(blocked(command)).toBe(true)
    expect(kind(command)).toBe("self-kill")
  })

  test.each(["kill 12345", "kill -TERM 4242", "taskkill /PID 77 /T /F", "fuser -k 3000/tcp"])("allows %s", (command) => {
    expect(blocked(command)).toBe(false)
  })
})
