/** The agent and model a session last used, so plugin-sent prompts keep them (fork roadmap 0.8). */
type Message = {
  info?: { role?: string; agent?: string; model?: { providerID?: string; modelID?: string }; providerID?: string; modelID?: string }
}

type MessagesClient = {
  session: { messages: (input: { path: { id: string } }) => Promise<unknown> }
}

export async function resolveSessionTarget(client: MessagesClient, sessionID: string): Promise<{ agent?: string; model?: string }> {
  const response = await client.session.messages({ path: { id: sessionID } })
  const messages = ((response as { data?: Message[] }).data ?? []) as Message[]
  const lastUser = [...messages].reverse().find((message) => message.info?.role === "user")?.info
  const lastAssistant = [...messages].reverse().find((message) => message.info?.role === "assistant")?.info
  const providerID = lastAssistant?.providerID ?? lastUser?.model?.providerID
  const modelID = lastAssistant?.modelID ?? lastUser?.model?.modelID
  return {
    ...(lastUser?.agent ? { agent: lastUser.agent } : {}),
    ...(providerID && modelID ? { model: `${providerID}/${modelID}` } : {}),
  }
}

/** `provider/model` or `provider/model(variant)` → SDK model fields. */
export function parseModel(model: string): { providerID: string; modelID: string; variant?: string } | undefined {
  const match = /^([^/]+)\/(.+?)(?:\(([\w-]+)\))?$/.exec(model.trim())
  if (!match?.[1] || !match[2]) return undefined
  return { providerID: match[1], modelID: match[2], ...(match[3] ? { variant: match[3] } : {}) }
}
