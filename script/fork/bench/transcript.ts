/** Turns the raw messages of an OpenCode session into the bench's Transcript. */
import type { ToolCall, Transcript } from "./types"

type RawPart = { type?: string; text?: string; synthetic?: boolean; tool?: string; state?: { status?: string; input?: Record<string, unknown>; output?: string; error?: string } }

type RawInfo = {
  role?: string
  agent?: string
  providerID?: string
  modelID?: string
  cost?: number
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  time?: { created?: number; completed?: number }
  error?: unknown
}

export type RawMessage = { info: RawInfo; parts: RawPart[] }

function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error)
  const { name, data } = error as { name?: string; data?: { message?: string } }
  return [name, data?.message ?? JSON.stringify(data ?? error)].filter(Boolean).join(": ")
}

export function toTranscript(messages: readonly RawMessage[], delegatedAgents: readonly string[] = []): Transcript {
  const assistants = messages.filter((message) => message.info.role === "assistant")
  const last = assistants.at(-1)
  const tools = assistants.flatMap((message) =>
    message.parts
      .filter((part) => part.type === "tool")
      .map((part): ToolCall => ({
        tool: part.tool ?? "?",
        status: part.state?.status ?? "unknown",
        input: part.state?.input ?? {},
        ...(part.state?.error === undefined ? {} : { error: part.state.error }),
      })),
  )
  const sum = (pick: (info: RawInfo) => number | undefined) => assistants.reduce((total, message) => total + (pick(message.info) ?? 0), 0)
  const start = messages[0]?.info.time?.created ?? 0
  const end = Math.max(0, ...messages.map((message) => message.info.time?.completed ?? message.info.time?.created ?? 0))
  // Only an error on the last message broke the run; an earlier one the session recovered from did not.
  const error = last === undefined
    ? "no assistant message in the session"
    : last.info.error === undefined ? undefined : errorText(last.info.error)
  return {
    agent: last?.info.agent ?? "",
    model: last ? `${last.info.providerID}/${last.info.modelID}` : "",
    answer: (last?.parts ?? []).filter((part) => part.type === "text" && !part.synthetic).map((part) => part.text ?? "").join("\n").trim(),
    tools,
    tokens: {
      input: sum((info) => info.tokens?.input),
      output: sum((info) => info.tokens?.output),
      reasoning: sum((info) => info.tokens?.reasoning),
      cacheRead: sum((info) => info.tokens?.cache?.read),
      cacheWrite: sum((info) => info.tokens?.cache?.write),
    },
    cost: sum((info) => info.cost),
    turns: assistants.length,
    durationMs: Math.max(0, end - start),
    delegatedAgents: [...delegatedAgents],
    ...(error === undefined ? {} : { error }),
  }
}
