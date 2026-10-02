import { describe, expect, test } from "bun:test"

import { PROCESS_GUIDANCE } from "../features/managed-process/guidance"
import { createSystemTransformHandler } from "./system-transform"

describe("managed process rule in every system prompt (fork 0.8b)", () => {
  test("is added once and says process_start is mandatory", async () => {
    const handler = createSystemTransformHandler(undefined, undefined, null, undefined, PROCESS_GUIDANCE)
    const output = { system: ["base"] }
    await handler({ model: { id: "m", providerID: "p" } }, output)
    await handler({ model: { id: "m", providerID: "p" } }, output)
    expect(output.system.filter((part) => part.includes("MANDATORY"))).toHaveLength(1)
    expect(output.system.at(-1)).toContain("process_start")
  })
})
