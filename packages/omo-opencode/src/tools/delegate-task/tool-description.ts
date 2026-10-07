import type { AvailableCategory, AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { mergeCategories } from "../../shared/merge-categories"
import { CATEGORY_CALLER_GUIDANCE } from "./builtin-categories"
import { CATEGORY_DESCRIPTIONS } from "./constants"
import type { DelegateTaskToolOptions } from "./types"

export interface DelegateTaskPresentation {
  availableCategories: AvailableCategory[]
  availableSkills: AvailableSkill[]
  categoryExamples: string
  description: string
}

type DelegateTaskPresentationOptions = Pick<
  DelegateTaskToolOptions,
  "availableCategories" | "availableSkills" | "userCategories"
>

export function createDelegateTaskPresentation(options: DelegateTaskPresentationOptions): DelegateTaskPresentation {
  const { userCategories } = options
  const allCategories = mergeCategories(userCategories)
  const categoryEntries = Object.entries(allCategories).map(([name, categoryConfig]) => ({
    name,
    categoryConfig,
    description: userCategories?.[name]?.description || CATEGORY_DESCRIPTIONS[name],
    callerGuidance: CATEGORY_CALLER_GUIDANCE[name],
  }))
  const categoryNames = categoryEntries.map(({ name }) => name)
  const categoryExamples = categoryNames.join(", ")

  const availableCategories: AvailableCategory[] = options.availableCategories
    ?? categoryEntries.map(({ name, categoryConfig, description }) => {
      return {
        name,
        description: description || "General tasks",
        model: categoryConfig.model,
      }
    })

  const availableSkills: AvailableSkill[] = options.availableSkills ?? []

  const categoryList = categoryEntries.map(({ name, description, callerGuidance }) => {
    const categoryLine = description ? `  - ${name}: ${description}` : `  - ${name}`
    const indentedGuidance = callerGuidance?.replaceAll("\n", "\n    ")
    return indentedGuidance ? `${categoryLine}\n    ${indentedGuidance}` : categoryLine
  }).join("\n")

  // Kept short: it is sent with every request of every agent that can delegate (incidents of 07-10-2026).
  const description = `Spawn an agent task. Provide EXACTLY ONE of category or subagent_type (omitting both fails; with both, subagent_type is ignored).
- category: spawns Sisyphus-Junior with that category's model. Available categories:
${categoryList}
- subagent_type: a specific agent (explore, librarian, oracle, metis, momus, …).
- load_skills: skill names to inject; defaults to [].
- run_in_background: true is the standard spawn (returns \`bg_...\` at once; the completion notification delivers the result). false blocks until the child finishes (a 30-minute inactivity window, reset by OpenCode busy/retry/running status, not a total wall-clock limit): only for a short child whose result gates your next call. Omitted = false.
- task_id: Continuation session id (\`ses_...\`) from task metadata, not the background task id (\`bg_...\`). Continues the same subagent with full context: use it to fix a failed/incomplete result or ask a follow-up instead of starting a new task.
Example: task(category="quick", description="Fix type error", prompt="...") or task(subagent_type="explore", description="Find patterns", prompt="...", run_in_background=true).
Prompts MUST be in English.`

  return {
    availableCategories,
    availableSkills,
    categoryExamples,
    description,
  }
}
