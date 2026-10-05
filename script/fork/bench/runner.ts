/** Runs one bench task against the sandboxed OpenCode and grades what really happened in the session. */
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import { gradersFor } from "./graders"
import { createStallDetector, progressSignature } from "./progress"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { prepareWorkdir, type Sandbox } from "./sandbox"
import { classifyFailure } from "./score"
import { toTranscript, type RawMessage } from "./transcript"
import type { GradeContext, RunResult, Task, Transcript } from "./types"

type Client = ReturnType<typeof createOpencodeClient>

const POLL_MS = 2000

async function messagesOf(client: Client, sessionID: string): Promise<RawMessage[]> {
  return ((await client.session.messages({ sessionID })).data ?? []) as RawMessage[]
}

async function childrenOf(client: Client, sessionID: string): Promise<string[]> {
  const children = ((await client.session.children({ sessionID })).data ?? []) as { id: string }[]
  return children.map((child) => child.id)
}

/** Agents of every descendant session (delegations of delegations included). */
async function delegatedAgents(client: Client, sessionID: string): Promise<string[]> {
  const agents: string[] = []
  for (const child of await childrenOf(client, sessionID)) {
    const first = (await messagesOf(client, child)).find((message) => message.info.role === "assistant")
    if (first?.info.agent) agents.push(first.info.agent)
    agents.push(...(await delegatedAgents(client, child)))
  }
  return agents
}

async function isIdle(client: Client, sessionID: string): Promise<boolean> {
  const statuses = ((await client.session.status({})).data ?? {}) as Record<string, { type?: string }>
  return (statuses[sessionID]?.type ?? "idle") === "idle"
}

type TaskPart = { type?: string; tool?: string; state?: { status?: string; error?: string } }

async function subtaskPart(client: Client, parentID: string): Promise<TaskPart | undefined> {
  const parts = (await messagesOf(client, parentID)).flatMap((message) => message.parts as TaskPart[])
  return parts.find((part) => part.type === "tool" && part.tool === "task")
}

/** The parent's `task` tool part, once the subagent finished (completed or error). */
async function finishedSubtask(client: Client, parentID: string): Promise<boolean> {
  const status = (await subtaskPart(client, parentID))?.state?.status
  return status === "completed" || status === "error"
}

const STALL_MS = 240_000

async function waitUntil(
  condition: () => Promise<boolean>,
  progress: () => Promise<string>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const detector = createStallDetector(STALL_MS)
  // Give the server a moment to register the prompt before the first idle check.
  await Bun.sleep(POLL_MS)
  while (!(await condition().catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`${label} timed out after ${timeoutMs / 1000}s`)
    if (detector.stalled(await progress().catch(() => ""))) throw new Error(`${label} stalled: no progress for ${STALL_MS / 1000}s`)
    await Bun.sleep(POLL_MS)
  }
}

/** Progress of a session and its delegations. */
async function sessionProgress(client: Client, sessionID: string): Promise<string> {
  const own = progressSignature((await messagesOf(client, sessionID)) as never)
  const children = await Promise.all((await childrenOf(client, sessionID)).map((child) => sessionProgress(client, child)))
  return [own, ...children].join("#")
}

const START_TIMEOUT_MS = 180_000

/** Nobody answers in a bench run: a question would wait forever, so it gets this reply (and the transcript keeps it). */
export const NO_USER_ANSWER = "No user is available in this run: decide yourself and explain your decision in your final answer."

export async function answerQuestions(client: Pick<Client, "question">): Promise<void> {
  const pending = ((await client.question.list({}).catch(() => ({ data: [] }))).data ?? []) as Array<{ id: string; questions?: unknown[] }>
  for (const question of pending) {
    const count = Math.max(1, question.questions?.length ?? 1)
    await client.question.reply({ requestID: question.id, answers: Array.from({ length: count }, () => [NO_USER_ANSWER]) }).catch(() => undefined)
  }
}

/** Busy, or an assistant message already exists. Not starting at all is an infrastructure failure. */
async function waitForStart(client: Client, sessionID: string, label: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const busy = !(await isIdle(client, sessionID).catch(() => true))
    const answered = (await messagesOf(client, sessionID).catch(() => [])).some((message) => (message as { info?: { role?: string } }).info?.role === "assistant")
    if (busy || answered) return
    await Bun.sleep(POLL_MS)
  }
  throw new Error(`${label} never started: no assistant activity within ${START_TIMEOUT_MS / 1000}s`)
}

/** Runs the task once and returns the transcript of the evaluated session (the subagent's, in subtask mode). */
async function execute(client: Client, task: Task): Promise<Transcript> {
  const session = await client.session.create({ title: `bench ${task.id}` })
  const parentID = (session.data as { id?: string } | undefined)?.id
  if (parentID === undefined) throw new Error(`server error creating session: ${JSON.stringify(session.error ?? {}).slice(0, 200)}`)
  if (task.mode === "primary") {
    await client.session.promptAsync({ sessionID: parentID, agent: task.agent, parts: [{ type: "text", text: task.prompt }] })
    try {
      // The session reads idle until the agent picks the prompt up: wait for it to start before waiting for idle,
      // or the run ends (and is aborted) before any work happens.
      await waitForStart(client, parentID, task.id)
      await waitUntil(async () => {
        await answerQuestions(client)
        return isIdle(client, parentID)
      }, () => sessionProgress(client, parentID), task.budget.timeoutMs, task.id)
    } finally {
      await client.session.abort({ sessionID: parentID }).catch(() => undefined)
    }
    return toTranscript(await messagesOf(client, parentID), await delegatedAgents(client, parentID))
  }

  // Subtask: OpenCode runs the real `task` tool with this agent as a subagent, exactly like an orchestrator's delegation.
  await client.session.promptAsync({
    sessionID: parentID,
    parts: [{ type: "subtask", agent: task.agent, description: task.id, prompt: task.prompt }],
  })
  try {
    await waitUntil(async () => {
      await answerQuestions(client)
      return finishedSubtask(client, parentID)
    }, () => sessionProgress(client, parentID), task.budget.timeoutMs, task.id)
  } finally {
    // Stop the parent's follow-up turn: only the subagent is evaluated, and the parent must not keep working.
    await client.session.abort({ sessionID: parentID }).catch(() => undefined)
  }
  const [childID] = await childrenOf(client, parentID)
  const transcript = childID === undefined ? toTranscript([]) : toTranscript(await messagesOf(client, childID), await delegatedAgents(client, childID))
  // When the subagent never answered, the reason is on the parent's task part (e.g. its model does not exist).
  const taskError = transcript.turns === 0 ? (await subtaskPart(client, parentID))?.state?.error : undefined
  return taskError === undefined ? transcript : { ...transcript, error: taskError }
}

export type RunOptions = {
  readonly baseUrl: string
  readonly sandbox: Sandbox
  readonly fixtureDir: string
  readonly repeat: number
  readonly attempt: number
  readonly fetchStatus?: (url: string) => Promise<number>
}

export async function runTask(task: Task, options: RunOptions): Promise<RunResult> {
  const workdirName = `${task.id.replaceAll("/", "_")}-r${options.repeat}-a${options.attempt}`
  try {
    return await runInWorkdir(task, options, workdirName)
  } finally {
    // Large fixtures (a whole repo) fill a RAM-backed /tmp fast; regrade.ts uses a fresh copy, so nothing is lost.
    rmSync(join(options.sandbox.root, "work", workdirName), { recursive: true, force: true })
  }
}

async function runInWorkdir(task: Task, options: RunOptions, workdirName: string): Promise<RunResult> {
  const workdir = prepareWorkdir(options.sandbox, options.fixtureDir, workdirName)
  const base = { taskId: task.id, repeat: options.repeat, attempt: options.attempt, workdir }
  let transcript: Transcript
  try {
    const client = createOpencodeClient({ baseUrl: options.baseUrl, directory: workdir })
    transcript = await execute(client, task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = classifyFailure(message)
    return { ...base, ...(failure === "task" ? { pass: false } : {}), failure, grades: [], error: message }
  }
  if (transcript.error !== undefined && classifyFailure(transcript.error) === "infra") {
    return { ...base, failure: "infra", grades: [], transcript, error: transcript.error }
  }
  const context: GradeContext = { transcript, workdir, ...(options.fetchStatus ? { fetchStatus: options.fetchStatus } : {}) }
  const grades = await Promise.all(gradersFor(task).map((grader) => grader.grade(context)))
  const pass = transcript.error === undefined && grades.every((grade) => grade.pass)
  return { ...base, pass, ...(pass ? {} : { failure: "task" as const }), grades, transcript, ...(transcript.error === undefined ? {} : { error: transcript.error }) }
}
