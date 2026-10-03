/** `resume_task` (fork roadmap 0.8c): list paused work or resume one with its card, saved diff and the user's hint. */
import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { ResumeService } from "../../features/resume/service"

export function createResumeTools(service: ResumeService): Record<string, ToolDefinition> {
  return {
    resume_task: tool({
      description: [
        "Resume work that stopped (retries spent, OpenCode closed, memory pressure, /stop-continuation).",
        "Without id: list paused work. With id: returns the resume card, the saved changes and the rules to continue;",
        "follow it and do not repeat the listed failed attempts.",
      ].join(" "),
      args: {
        id: tool.schema.string().optional().describe("Resume id from the list, e.g. run_ses_…"),
        hint: tool.schema.string().optional().describe("The user's hint for this attempt"),
      },
      async execute(args) {
        return service.resume(args.id, args.hint)
      },
    }),
  }
}

export function createHandoffTools(service: ResumeService): Record<string, ToolDefinition> {
  return {
    handoff_save: tool({
      description: [
        "Save a /handoff summary as resumable work: the next session continues with resume_task (or by saying \"reanuda\"),",
        "with the summary, the user's verbatim requests and the uncommitted work saved alongside.",
      ].join(" "),
      args: { summary: tool.schema.string().describe("The full HANDOFF CONTEXT text") },
      async execute(args, toolContext) {
        const card = await service.pause((toolContext as unknown as { sessionID: string }).sessionID, "handoff created by the user", [], args.summary)
        return `Handoff saved as ${card.id}${card.wip ? ` with the uncommitted work in ${card.wip.ref}` : ""}. In the new session the user can just say "reanuda" (or run /omo-resume).`
      },
    }),
  }
}
