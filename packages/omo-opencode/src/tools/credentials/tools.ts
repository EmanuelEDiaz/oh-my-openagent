/** `credential` (fork roadmap 0.21, entrega 2): test passwords the agent set, used without showing them. */
import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { CredentialStore } from "../../features/credentials/store"

const reference = (name: string) => `\${OMO_SECRET:${name}}`

export function createCredentialTools(store: CredentialStore): Record<string, ToolDefinition> {
  return {
    credential: tool({
      description: "Test passwords saved for this project (captured automatically when you set them). get: the ${OMO_SECRET:name} reference to put in a command; the plugin inserts the value without showing it. list: what is saved. save: keep one you chose. Never drop a database because a password failed: get it here.",
      args: {
        action: tool.schema.enum(["get", "list", "save"]),
        name: tool.schema.string().optional(),
        value: tool.schema.string().optional().describe("save only"),
        user: tool.schema.string().optional(),
        host: tool.schema.string().optional(),
        database: tool.schema.string().optional(),
        reveal: tool.schema.boolean().optional().describe("get only: show the value itself (only if the user asked)"),
      },
      async execute(args, toolContext) {
        if (args.action === "list") {
          const entries = store.list()
          if (entries.length === 0) return "No test credentials saved for this project."
          return entries.map((entry) => `- ${entry.name}${entry.user ? ` (user ${entry.user})` : ""} from ${entry.origin}: use ${reference(entry.name)}`).join("\n")
        }
        if (!args.name) return "Give the credential name (see action: list)."
        if (args.action === "save") {
          if (!args.value) return "save needs a value."
          const sessionID = (toolContext as unknown as { sessionID?: string }).sessionID
          store.save({ name: args.name, kind: "generic", value: args.value, origin: "saved by the agent", ...(sessionID ? { session: sessionID } : {}), ...(args.user ? { user: args.user } : {}), ...(args.host ? { host: args.host } : {}), ...(args.database ? { database: args.database } : {}) })
          return `Saved as ${args.name}. Use ${reference(args.name)} in commands.`
        }
        const entry = store.get(args.name)
        if (!entry) {
          const names = store.list().map((item) => item.name)
          return `No credential named ${args.name}. ${names.length ? `Saved: ${names.join(", ")}.` : "None saved yet."}`
        }
        const details = [entry.user && `user ${entry.user}`, entry.host && `host ${entry.host}`, entry.database && `database ${entry.database}`, `from ${entry.origin}`, entry.history.length > 0 && `${entry.history.length} earlier value(s) kept`].filter(Boolean).join(", ")
        if (args.reveal) return `${args.name} = ${entry.value} (${details}). Do not write it into files or commits.`
        return `Use ${reference(args.name)} in the command (${details}).`
      },
    }),
  }
}
