/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { judgeKills, type KillContext } from "./kill-policy"

// OpenCode = 500 (group 480, session 470), its parent shell 400, the terminal 300; the agent started 900 (its own group).
const ctx: KillContext = {
  protectedPids: new Set([1, 300, 400, 500]),
  protectedGroups: new Set([470, 480]),
  ownedPids: new Set([900]),
  groupOf: (pid) => (pid === 901 ? 900 : pid === 950 ? 950 : undefined),
}

const decide = (command: string) => judgeKills(command, ctx)?.decision ?? "not-a-kill"

describe("the holes of the old regex guard are closed", () => {
  test.each([
    "sudo pkill -f node",
    "kill $(pgrep -f vite)",
    "bash -c 'pkill -f node'",
    "kill -9 $PPID",
    "kill 500",
    "kill -- -480",
    "kill -9 -480",
    "pwsh -c 'Stop-Process -Name node'",
    "Stop-Process -Name node -Force",
    "fuser -k 3000/tcp",
    "pgrep -f node | xargs kill -9",
    "killall node",
    "taskkill /IM node.exe /F",
    "tmux kill-server",
    "kill -1",
    "kill 0",
    "kill 1",
    "echo ok && kill 400",
  ])("denied: %s", (command) => {
    expect(decide(command)).toBe("deny")
  })
})

describe("the agent can stop what it started", () => {
  test.each([
    "kill 900",
    "kill -TERM 900",
    "kill -s KILL 900",
    "kill 901",
    "kill -- -900",
    "taskkill /PID 900 /T /F",
    "Stop-Process -Id 900",
    "kill %1",
    "kill -l",
  ])("allowed: %s", (command) => {
    expect(decide(command)).toBe("allow")
  })
})

describe("anything else is not the agent's to kill", () => {
  test("a PID the agent did not start is refused with a way to ask", () => {
    const verdict = judgeKills("kill 12345", ctx)
    const message = verdict?.decision === "deny" ? verdict.message : ""
    expect(message).toContain("process_stop")
    expect(message).toContain("ask the user")
  })

  test("a command that cannot be read and kills is refused", () => {
    expect(decide("kill $(pgrep -f 'x")).toBe("deny")
  })

  test("commands that do not kill are not judged here", () => {
    expect(decide("pgrep -f node")).toBe("not-a-kill")
    expect(decide("echo 'kill 1'")).toBe("not-a-kill")
    expect(decide("grep -r 'pkill -f' src")).toBe("not-a-kill")
  })

  test("a private tmux server can be closed", () => {
    expect(decide("tmux -L omo-qa-123 kill-server")).toBe("allow")
  })
})
