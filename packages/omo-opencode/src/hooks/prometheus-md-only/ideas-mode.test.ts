/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { IDEAS_MODE_MARKER } from "../../features/ideas-mode/gate"
import { createPrometheusMdOnlyHook } from "./hook"

// Fork roadmap 0.23 layer 1: in ideas mode the plan is written only on the user's explicit order.
const SESSION = "ses_ideas_mode"
const ideas = `${IDEAS_MODE_MARKER}\n<user-request></user-request>`

function hook(userTexts: string[] | undefined) {
  setSessionAgent(SESSION, "prometheus")
  return createPrometheusMdOnlyHook({ client: {}, directory: "/tmp/project" } as never, { readUserTexts: async () => userTexts })
}

async function writePlan(texts: string[] | undefined, path = "/tmp/project/.omo/plans/feature.md") {
  const output = { args: { filePath: path, content: "# plan" } as Record<string, unknown> }
  return hook(texts)["tool.execute.before"]({ tool: "write", sessionID: SESSION, callID: "c" }, output)
}

describe("Prometheus plan writes in ideas mode", () => {
  afterEach(() => clearSessionAgent(SESSION))

  test("refused while the user is only talking about ideas", async () => {
    await expect(writePlan([ideas, "the guards could live in the sidebar", "sí, me gusta"])).rejects.toThrow("has not asked to add")
  })

  test("allowed on the user's explicit order", async () => {
    await expect(writePlan([ideas, "the guards could live in the sidebar", "añádelo al plan"])).resolves.toBeUndefined()
  })

  test("the ideas file itself is always writable in ideas mode", async () => {
    await expect(writePlan([ideas, "sí"], "/tmp/project/.omo/ideas.md")).resolves.toBeUndefined()
  })

  test("outside ideas mode, or when the messages cannot be read, planning works as before", async () => {
    await expect(writePlan(["write the plan for the login page"])).resolves.toBeUndefined()
    await expect(writePlan(undefined)).resolves.toBeUndefined()
  })
})
