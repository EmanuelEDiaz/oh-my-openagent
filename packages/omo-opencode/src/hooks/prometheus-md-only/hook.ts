import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, BLOCKED_TOOLS, PLANNING_CONSULT_WARNING, PLANNING_CONTEXT_OPEN, PROMETHEUS_WORKFLOW_REMINDER, WORKSPACE_REWRITE_TOOLS } from "./constants"
import { extractTargetPaths } from "./target-paths"
import { log } from "../../shared/logger"
import { replaceToolArgs } from "../../shared/replace-tool-args"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { getAgentFromSession } from "./agent-resolution"
import { isPrometheusAgent } from "./agent-matcher"
import { isAllowedFile } from "./path-policy"
import { planWriteRefusal } from "../../features/ideas-mode/gate"
import { readSessionUserTexts } from "../../features/ideas-mode/session-user-texts"

const TASK_TOOLS = ["task", "call_omo_agent"]

export type PrometheusMdOnlyDeps = {
  /** The user's own message texts, oldest first; undefined when they cannot be read (ideas mode, roadmap 0.23). */
  readonly readUserTexts?: (sessionID: string) => Promise<string[] | undefined>
}

export function createPrometheusMdOnlyHook(ctx: PluginInput, deps: PrometheusMdOnlyDeps = {}) {
  const readUserTexts = deps.readUserTexts ?? ((sessionID: string) => readSessionUserTexts(ctx.client, sessionID))
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isPrometheusAgent(agentName)) {
        return
      }

      const toolName = input.tool

      // Inject planning-only warning for task tools called by Prometheus
       if (TASK_TOOLS.includes(toolName)) {
         const prompt = output.args.prompt as string | undefined
         if (prompt && !prompt.includes(PLANNING_CONTEXT_OPEN)) {
           replaceToolArgs(output, { prompt: PLANNING_CONSULT_WARNING + prompt })
          log(`[${HOOK_NAME}] Injected planning warning to ${toolName}`, {
            sessionID: input.sessionID,
            tool: toolName,
            agent: agentName,
          })
        }
        return
      }

      const normalizedTool = toolName.toLowerCase()
      const rewritesWorkspace = WORKSPACE_REWRITE_TOOLS.includes(normalizedTool)
      if (!rewritesWorkspace && !BLOCKED_TOOLS.includes(normalizedTool)) {
        return
      }

      // Fail closed: a write whose targets cannot all be identified, or a workspace-wide rewrite, is blocked.
      const targets = rewritesWorkspace ? [] : extractTargetPaths(output.args)
      const filePath = rewritesWorkspace
        ? `(workspace-wide ${toolName})`
        : targets.find((target) => !isAllowedFile(target, ctx.directory)) ?? (targets.length === 0 ? "(no target path given)" : undefined)

       if (filePath !== undefined) {
         log(`[${HOOK_NAME}] Blocked: Prometheus can only write to .omo/*.md`, {
           sessionID: input.sessionID,
           tool: toolName,
           filePath,
           agent: agentName,
         })
         throw new Error(
           `[${HOOK_NAME}] Prometheus is a planning agent. File operations restricted to .omo/*.md plan files only. ` +
           `Do NOT route this change through a subagent either - delegated implementation is still implementation. ` +
           `Record the intended change as a todo in the plan; implementation starts only when the user runs /ulw-execute. ` +
           `Attempted to modify: ${filePath}.`
         )
       }

      const writesPlan = targets.some((target) => target.toLowerCase().replace(/\\/g, "/").includes(".omo/plans/"))
      if (writesPlan) {
        const userTexts = await readUserTexts(input.sessionID)
        const refusal = userTexts === undefined ? undefined : planWriteRefusal(userTexts)
        if (refusal) {
          log(`[${HOOK_NAME}] Blocked plan write: ideas mode without the user's order`, { sessionID: input.sessionID, targets })
          throw new Error(refusal)
        }
        log(`[${HOOK_NAME}] Injecting workflow reminder for plan write`, {
          sessionID: input.sessionID,
          tool: toolName,
          targets,
          agent: agentName,
        })
        output.message = (output.message || "") + PROMETHEUS_WORKFLOW_REMINDER
      }

      log(`[${HOOK_NAME}] Allowed: .omo/*.md write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        targets,
        agent: agentName,
      })
    },
  }
}
