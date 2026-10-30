import { describe, expect, test } from "bun:test"

import { createBashFileReadGuardHook } from "./bash-file-read-guard"

type AfterOutput = { title: string; output: string; metadata: unknown }

async function run(command: string): Promise<string> {
  const hook = createBashFileReadGuardHook()
  const input = { tool: "bash", sessionID: "ses_1", callID: "call_1" }
  await hook["tool.execute.before"]?.(input, { args: { command } })
  const output: AfterOutput = { title: "bash", output: "file text", metadata: {} }
  await hook["tool.execute.after"]?.({ ...input, args: { command } }, output)
  return output.output
}

describe("bash-file-read-guard", () => {
  // Fork incident H43 (28-10-2026): the warning was set on `output.message` in tool.execute.before, which OpenCode
  // never reads (that hook's output only carries `args`), so the model never saw it.
  test("#given a plain cat of a file #then the warning reaches the model in the bash output", async () => {
    const output = await run("cat src/a.ts")
    expect(output.startsWith("file text")).toBe(true)
    expect(output).toContain("Prefer the Read tool")
  })

  test("#given a command that is not a plain file read #then the output is untouched", async () => {
    expect(await run("cat src/a.ts | grep x")).toBe("file text")
    expect(await run("bun test")).toBe("file text")
  })
})
