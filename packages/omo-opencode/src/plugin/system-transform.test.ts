/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

describe("system transform grounding guidance", () => {
  test("adds the grounding block once, even when the hook fires again after compaction", async () => {
    // given
    const { createSystemTransformHandler } = await import("./system-transform")
    const { GROUNDING_GUIDANCE } = await import("../features/knowledge/grounding")
    const handler = createSystemTransformHandler(undefined, undefined, null, GROUNDING_GUIDANCE)
    const output = { system: ["base prompt"] }

    // when
    await handler({ model: { id: "big-pickle", providerID: "opencode" } }, output)
    await handler({ model: { id: "big-pickle", providerID: "opencode" } }, output)

    // then
    expect(output.system.filter((part) => part.includes("<grounding>"))).toHaveLength(1)
  })

  test("adds nothing when knowledge is disabled", async () => {
    // given
    const { createSystemTransformHandler } = await import("./system-transform")
    const output = { system: ["base prompt"] }

    // when
    await createSystemTransformHandler()({ model: { id: "m", providerID: "p" } }, output)

    // then
    expect(output.system).toEqual(["base prompt"])
  })
})
