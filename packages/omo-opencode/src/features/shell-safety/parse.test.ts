/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseShell } from "./parse"

const argvs = (command: string) => parseShell(command).commands.map((entry) => entry.argv)

describe("splitting and quoting", () => {
  test("separators, pipes and background", () => {
    expect(argvs("cd app && npm test; echo done | tee log & sleep 1")).toEqual([["cd", "app"], ["npm", "test"], ["echo", "done"], ["tee", "log"], ["sleep", "1"]])
  })

  test("quotes keep separators as text", () => {
    expect(argvs(`echo "a; b && c" 'd | e'`)).toEqual([["echo", "a; b && c", "d | e"]])
  })

  test("escapes and adjacent quoting", () => {
    expect(argvs(`echo it\\'s "x"'y'z`)).toEqual([["echo", "it's", "xyz"]])
  })

  test("redirections are not arguments", () => {
    expect(argvs("psql -c 'select 1' > out.txt 2>&1 < in.sql")).toEqual([["psql", "-c", "select 1"]])
  })

  test("leading variable assignments are skipped", () => {
    expect(argvs("NODE_ENV=test FOO='a b' bun test")).toEqual([["bun", "test"]])
    expect(parseShell("NODE_ENV=test bun test").commands[0]?.env).toEqual({ NODE_ENV: "test" })
  })

  test("comments are ignored", () => {
    expect(argvs("ls # pkill -f node")).toEqual([["ls"]])
  })
})

describe("nested commands are parsed too", () => {
  test("command substitution, in and out of double quotes, and backticks", () => {
    expect(argvs("kill $(pgrep -f vite)")).toContainEqual(["pgrep", "-f", "vite"])
    expect(argvs(`echo "pid: $(cat pid.txt)"`)).toContainEqual(["cat", "pid.txt"])
    expect(argvs("kill `cat server.pid`")).toContainEqual(["cat", "server.pid"])
  })

  test("a substituted argument is marked dynamic", () => {
    const kill = parseShell("kill -9 $(pgrep -f vite)").commands.find((entry) => entry.argv[0] === "kill")
    expect(kill?.dynamic).toBe(true)
    expect(parseShell("kill $PID").commands[0]?.dynamic).toBe(true)
    expect(parseShell("kill 1234").commands[0]?.dynamic).toBe(false)
  })

  test("bash -c / sh -c scripts are parsed", () => {
    expect(argvs(`bash -c 'pkill -f node; echo ok'`)).toContainEqual(["pkill", "-f", "node"])
    expect(argvs(`sh -lc "docker volume rm data"`)).toContainEqual(["docker", "volume", "rm", "data"])
  })
})

describe("wrappers are unwrapped to the real command", () => {
  test.each([
    ["sudo pkill -f node", ["pkill", "-f", "node"]],
    ["sudo -u postgres dropdb app", ["dropdb", "app"]],
    ["env -i PATH=/bin kill 12", ["kill", "12"]],
    ["nohup node server.js", ["node", "server.js"]],
    ["timeout -s KILL 10 psql -c 'drop table x'", ["psql", "-c", "drop table x"]],
    ["nice -n 10 rm -rf data", ["rm", "-rf", "data"]],
    ["setsid -f node x.js", ["node", "x.js"]],
    ["command kill 5", ["kill", "5"]],
    ["exec kill 5", ["kill", "5"]],
    ["time npm test", ["npm", "test"]],
  ])("%s", (command, expected) => {
    expect(argvs(command)).toContainEqual(expected)
  })

  test("xargs runs its command with arguments from stdin (dynamic)", () => {
    const parsed = parseShell("pgrep -f node | xargs -r kill -9")
    const kill = parsed.commands.find((entry) => entry.argv[0] === "kill")
    expect(kill?.argv).toEqual(["kill", "-9"])
    expect(kill?.dynamic).toBe(true)
  })

  test("the wrapper itself is remembered", () => {
    expect(parseShell("sudo kill 1").commands[0]?.wrappers).toEqual(["sudo"])
  })
})

describe("heredocs", () => {
  test("the heredoc body is attached to its command as stdin", () => {
    const parsed = parseShell("psql app <<'SQL'\nDROP TABLE users;\nSQL\necho after")
    expect(parsed.commands[0]?.argv).toEqual(["psql", "app"])
    expect(parsed.commands[0]?.stdin).toContain("DROP TABLE users;")
    expect(parsed.commands[1]?.argv).toEqual(["echo", "after"])
  })

  test("a here-string is stdin too", () => {
    expect(parseShell("mysql app <<< 'TRUNCATE logs'").commands[0]?.stdin).toBe("TRUNCATE logs")
  })
})

describe("unparseable input is reported, never guessed", () => {
  test.each([`echo "unterminated`, "kill $(pgrep -f x", "echo 'open"])("%s", (command) => {
    expect(parseShell(command).ok).toBe(false)
  })

  test("well-formed input is ok", () => {
    expect(parseShell("echo hi && ls").ok).toBe(true)
  })
})
