import type { CommandDefinition } from "../claude-code-command-loader"
import { isAgentRegistered } from "../claude-code-session-state"
import type { BuiltinCommandName, BuiltinCommands } from "./types"
import { GOAL_TEMPLATE } from "./templates/goal"
import { STOP_CONTINUATION_TEMPLATE } from "./templates/stop-continuation"
import { REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM } from "./templates/refactor"
import { ULW_EXECUTE_TEMPLATE } from "./templates/ulw-execute"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { REMOVE_AI_SLOPS_TEMPLATE, REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM } from "./templates/remove-ai-slops"
import { HYPERPLAN_TEMPLATE } from "./templates/hyperplan"
import { IDEAS_MODE_MARKER } from "../ideas-mode/gate"

interface LoadBuiltinCommandsOptions {
  useRegisteredAgents?: boolean
  teamModeEnabled?: boolean
}

function resolveUlwExecuteAgent(options?: LoadBuiltinCommandsOptions): "atlas" | "sisyphus" {
  if (options?.useRegisteredAgents) {
    return isAgentRegistered("atlas") ? "atlas" : "sisyphus"
  }

  return "atlas"
}

function withTeamModeAddendum(baseTemplate: string, addendum: string, teamModeEnabled: boolean): string {
  return teamModeEnabled ? `${baseTemplate}\n${addendum}` : baseTemplate
}

function createBuiltinCommandDefinitions(
  options?: LoadBuiltinCommandsOptions,
): Record<BuiltinCommandName, Omit<CommandDefinition, "name">> {
  const teamModeEnabled = options?.teamModeEnabled ?? false
  const refactorContent = withTeamModeAddendum(REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM, teamModeEnabled)
  const removeAiSlopsContent = withTeamModeAddendum(
    REMOVE_AI_SLOPS_TEMPLATE,
    REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM,
    teamModeEnabled,
  )

  return {
    goal: {
      description: "(builtin) Set, show, pause, resume, or clear the active thread goal",
      template: `<command-instruction>
${GOAL_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
      argumentHint: "<objective> | pause | resume | clear",
    },
    refactor: {
      description:
        "(builtin) Intelligent refactoring command with LSP, AST-grep, architecture analysis, codemap, and TDD verification.",
      template: `<command-instruction>
${refactorContent}
</command-instruction>`,
      argumentHint: "<refactoring-target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]",
    },
    "ulw-execute": {
      description: "(builtin) Execute an Atlas work session from a Prometheus plan",
      agent: resolveUlwExecuteAgent(options),
      template: `<command-instruction>
${ULW_EXECUTE_TEMPLATE}
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[plan-name] [--worktree <path>] [--make-pr] [--ship]",
    },
    "omo-ideas": {
      description: "(builtin) Brainstorm ideas with Prometheus; research them; nothing enters the plan until you say so (/omo-ideas off to leave)",
      agent: "prometheus",
      template: `${IDEAS_MODE_MARKER}
<command-instruction>
Ideas mode (the user's text is below; "off" means leave ideas mode and confirm it in one line).
- Talk the idea through: ONE question per message, with options when you can. Critique it honestly: what is right,
  what is wrong, why, and a better version.
- To check whether something exists or works, delegate to web-researcher (open web) or explore (this repository) and
  record the answer with its sources.
- Keep every idea in .omo/ideas.md: title, date, status (raw | researched | in plan | discarded), summary, sources.
  Read it first: earlier ideas live there.
- Do NOT write .omo/plans/ until the user explicitly says to add an idea to the plan; the plugin refuses it otherwise.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[idea | off]",
    },
    "omo-resume": {
      description: "(builtin) Resume work that stopped (retries spent, OpenCode closed, memory pressure) without losing it",
      template: `<command-instruction>
Call the resume_task tool. If the user gave an id, call resume_task({ id, hint }) with the rest of their text as the hint;
otherwise call resume_task() to list paused work and ask the user which one to resume (use the question tool).
Then continue exactly as the returned card says.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[run_id] [hint]",
    },
    "stop-continuation": {
      description: "(builtin) Stop all continuation mechanisms (ralph loop, todo continuation, boulder) for this session",
      template: `<command-instruction>
${STOP_CONTINUATION_TEMPLATE}
</command-instruction>`,
    },
    "remove-ai-slops": {
      description: "(builtin) Remove AI-generated code smells from branch changes and critically review the results",
      template: `<command-instruction>
${removeAiSlopsContent}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    },
    handoff: {
      description: "(builtin) Create a detailed context summary for continuing work in a new session",
      template: `<command-instruction>
${HANDOFF_TEMPLATE}
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[goal]",
    },
    hyperplan: {
      description: "(builtin) Adversarial multi-agent planning via team-mode (5 hostile category members cross-critique, lead synthesizes)",
      template: `<command-instruction>
${HYPERPLAN_TEMPLATE}
</command-instruction>`,
      argumentHint: "[planning-request]",
    },
  }
}

export function loadBuiltinCommands(
  disabledCommands?: BuiltinCommandName[],
  options?: LoadBuiltinCommandsOptions,
): BuiltinCommands {
  const builtinCommandDefinitions = createBuiltinCommandDefinitions(options)
  const disabled = new Set(disabledCommands ?? [])
  const commands: BuiltinCommands = {}

  for (const [name, definition] of Object.entries(builtinCommandDefinitions)) {
    if (!disabled.has(name as BuiltinCommandName)) {
      const { argumentHint: _argumentHint, ...openCodeCompatible } = definition
      commands[name] = { ...openCodeCompatible, name } as CommandDefinition
    }
  }

  return commands
}
