import { describe, expect, spyOn, test } from "bun:test"

import { createBuiltinAgents } from "./builtin-agents"
import * as shared from "../shared"

// Fork roadmap 0.22: a tab agent's prompt advertises only the specialists it may call (and costs less context).
async function build(tabAgentRoles: boolean) {
	const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set(["anthropic/claude-opus-4-8"]))
	try {
		return await createBuiltinAgents([], {}, undefined, "anthropic/claude-opus-4-8", undefined, undefined, [], [], undefined, undefined, undefined, false, false, false, tabAgentRoles)
	} finally {
		fetchSpy.mockRestore()
	}
}

describe("tab agent prompts list only their own specialists", () => {
	test("Sisyphus no longer advertises git-committer; Atlas, which owns it, does", async () => {
		const agents = await build(true)
		expect(agents.sisyphus?.prompt).not.toContain("`git-committer`")
		expect(agents.sisyphus?.prompt).toContain("`verifier`")
		expect(agents.atlas?.prompt).toContain("git-committer")
	})

	test("with the roles switched off every specialist is advertised as before", async () => {
		const agents = await build(false)
		expect(agents.sisyphus?.prompt).toContain("`git-committer`")
	})
})
