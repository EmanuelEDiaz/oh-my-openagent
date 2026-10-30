import { describe, expect, test } from "bun:test"

import { classifyCommand } from "./classify"

const blocked = (command: string) => classifyCommand(command).block
const kind = (command: string) => classifyCommand(command).kind

describe("long-running commands must use process_start (fork 0.8b)", () => {
  test.each([
    "npm install", "npm i lodash", "npm ci", "pnpm add zod", "yarn", "yarn install", "bun install", "bun add x",
    "pip install requests", "python -m pip install -r requirements.txt", "uv sync", "poetry install",
    "cargo install ripgrep", "composer install", "brew install sg",
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

// Fork incident H45 (30-10-2026, real-project lab): instant version checks and calls to the app's own local server were
// refused as long-running, and in a `;` chain one such part blocked the whole command.
describe("instant commands that look like long-running ones are allowed (H45)", () => {
  test.each([
    "mvn -v", "mvn -version", "mvn --version 2>&1 | head -4", "docker --version", "pnpm -v", "./gradlew --version",
    "pnpm -v 2>&1; node -v 2>&1; mvn -v 2>&1 | head -4; psql --version 2>&1; docker --version 2>&1",
    'echo "=== mvn ==="; mvn -version 2>&1 | head -5; echo "=== node ==="; node -v',
    "curl -sS http://localhost:8080/v3/api-docs -o /tmp/inv-openapi.json",
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/pos",
    "wget -qO- http://[::1]:8080/actuator/health",
  ])("allows %s", (command) => {
    expect(blocked(command)).toBe(false)
  })

  test.each(["mvn -V package", "curl -o big.iso https://example.com/big.iso", "curl -O http://localhost.example.com/x.tgz"])(
    "still blocks %s",
    (command) => {
      expect(kind(command)).toBe("long-running")
    },
  )
})

// Fork incident H46 (30-10-2026, real-project lab): the agent started the system Docker daemon as root with
// `sudo -n systemctl start docker`; passwordless sudo let it through. Root actions belong to the user.
describe("commands that run as root are refused (H46)", () => {
  test.each([
    "sudo -n systemctl start docker", "sudo apt-get install -y jq", "cd /tmp && sudo rm -rf x", "doas pacman -S jq",
    "pkexec systemctl restart docker", "run0 systemctl stop docker", "su -c 'systemctl start docker'",
    "sudo -n systemctl start docker 2>&1 || sudo -n service docker start 2>&1",
  ])("blocks %s", (command) => {
    expect(blocked(command)).toBe(true)
    expect(kind(command)).toBe("privileged")
  })

  test.each(["echo sudo is not used here", "grep -r sudo docs", "docker ps", "systemctl --user status x"])("allows %s", (command) => {
    expect(blocked(command)).toBe(false)
  })

  test("the message tells the agent to ask the user", () => {
    expect(classifyCommand("sudo systemctl start docker").message).toContain("! sudo systemctl start docker")
  })
})
