import { describe, expect, spyOn, test } from "bun:test"
import { createBuiltinAgents } from "./builtin-agents"
import { customAgentsForDelegation } from "./custom-agent-visibility"
import * as shared from "../shared"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-8"

describe("createBuiltinAgents custom agent visibility", () => {
	test("#given runtime custom subagents #when orchestrator prompts are built #then they are advertised for delegation as optional", async () => {
		//#given
		const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
			new Set(["anthropic/claude-opus-4-8", "openai/gpt-5.5", "openai/gpt-5.6-sol"])
		)

		try {
			//#when
			const agents = await createBuiltinAgents(
				[],
				{},
				undefined,
				TEST_DEFAULT_MODEL,
				undefined,
				undefined,
				[],
				[
					{
						name: "backend-engineer",
						description: "Custom backend specialist",
					},
				]
			)

			//#then
			expect(agents.sisyphus.prompt).toContain("→ `backend-engineer` - Custom backend specialist — optional")
			expect(agents.atlas.prompt).toContain("backend-engineer")
		} finally {
			fetchSpy.mockRestore()
		}
	})
})

describe("customAgentsForDelegation", () => {
	test("#given mixed agent summaries #then only delegatable, described, unique custom subagents are kept", () => {
		//#when
		const agents = customAgentsForDelegation(
			[
				{ name: "backend-engineer", description: "Custom backend specialist" },
				{ name: "Backend-Engineer", description: "duplicate from another source" },
				{ name: "planning", description: "Plans work", mode: "primary" },
				{ name: "secret", description: "Hidden helper", hidden: true },
				{ name: "undocumented", description: "" },
				{ name: "explore", description: "clashes with a builtin" },
				{ name: "build", description: "OpenCode native" },
				{ name: "legacy", description: "Disabled by the user" },
				{ name: "switched-off", description: "Disabled in its own config", disable: true },
				"not an object",
			],
			new Set(["explore", "sisyphus"]),
			["legacy"],
		)

		//#then
		expect(agents.map((agent) => agent.name)).toEqual(["backend-engineer"])
		expect(agents[0]?.metadata.requirement).toEqual({ level: "optional" })
	})

	test("#given a long description #then the delegation trigger is clipped", () => {
		//#when
		const [agent] = customAgentsForDelegation([{ name: "writer", description: "x".repeat(500) }], new Set(), [])

		//#then
		expect(agent?.metadata.triggers[0]?.trigger.length).toBeLessThanOrEqual(201)
	})
})
