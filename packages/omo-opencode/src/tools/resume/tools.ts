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
