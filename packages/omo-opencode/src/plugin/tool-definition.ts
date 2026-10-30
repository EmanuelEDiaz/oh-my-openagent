import type { CreatedHooks } from "../create-hooks"
import { liveSkillDescription } from "../tools/skill/live-description"

export function createToolDefinitionHandler(args: {
  hooks: CreatedHooks
}): (
  input: { toolID: string },
  output: { description: string; parameters: unknown },
) => Promise<void> {
  const { hooks } = args
  return async (input, output) => {
    if (input.toolID === "skill") {
      const live = await liveSkillDescription.get()
      if (live) output.description = live
    }
    const overrideHook = hooks.todoDescriptionOverride
    if (overrideHook) {
      await overrideHook["tool.definition"](input, output)
    }
  }
}
