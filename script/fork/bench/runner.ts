/** Runs one bench task against the sandboxed OpenCode and grades what really happened in the session. */
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import { gradersFor } from "./graders"
import { createStallDetector, progressSignature } from "./progress"
import { existsSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

import { prepareWorkdir, type Sandbox } from "./sandbox"
import { classifyFailure } from "./score"
import { toTranscript, type RawMessage } from "./transcript"
import type { GradeContext, GradeResult, RunResult, Task, Transcript } from "./types"

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

/**
 * Above the plugin's stall watchdog (240 s of silence + a 15 s check + its recovery): the bench must see whether the
 * plugin recovers before it gives up on the run itself.
 */
const STALL_MS = 420_000

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

/** Replies to every pending question; resolves how many were pending. */
export async function answerQuestions(client: Pick<Client, "question">): Promise<number> {
  const pending = ((await client.question.list({}).catch(() => ({ data: [] }))).data ?? []) as Array<{ id: string; questions?: unknown[] }>
  for (const question of pending) {
    const count = Math.max(1, question.questions?.length ?? 1)
    await client.question.reply({ requestID: question.id, answers: Array.from({ length: count }, () => [NO_USER_ANSWER]) }).catch(() => undefined)
  }
  return pending.length
}

/**
 * Nobody approves in a bench run either: a pending permission would block the agent (a subagent blocked this way is
 * invisible to its parent). Each one is allowed once and recorded in `seen` (id → what was asked) as a metric.
 * Resolves how many were pending.
 */
export async function answerPermissions(client: Pick<Client, "permission">, seen: Map<string, string>): Promise<number> {
  const pending = ((await client.permission.list({}).catch(() => ({ data: [] }))).data ?? []) as Array<{ id: string; permission?: string; patterns?: string[] }>
  for (const request of pending) {
    seen.set(request.id, `${request.permission ?? "?"}: ${(request.patterns ?? []).join(" ")}`.slice(0, 160))
    await client.permission.reply({ requestID: request.id, reply: "once" }).catch(() => undefined)
  }
  return pending.length
}

/** How long the session must stay idle, with nothing pending, before a primary task counts as done. */
export const IDLE_SETTLE_MS = 5000

/**
 * A primary session reads idle for a moment between turns (a managed process about to wake it, a question being
 * answered): it is done only after it stays quiet across consecutive polls for `settleMs`.
 */
export function createIdleDebounce(settleMs: number, now: () => number = Date.now) {
  let quietSince: number | undefined
  return {
    /** Records this poll (true = idle with nothing pending) and says whether it has been so for the whole window. */
    settled(quiet: boolean): boolean {
      if (!quiet) {
        quietSince = undefined
        return false
      }
      quietSince ??= now()
      return now() - quietSince >= settleMs
    },
  }
}

/**
 * The plugin's managed processes for this workdir (`.omo/proc/processes.json`, written by
 * `S/features/managed-process/manager.ts`): busy while one runs that the agent was not told about yet, or a notice
 * waits for the session to go idle.
 */
export function managedProcessesBusy(workdir: string): boolean {
  const registry = join(workdir, ".omo", "proc", "processes.json")
  if (!existsSync(registry)) return false
  try {
    const entries = JSON.parse(readFileSync(registry, "utf8")) as Array<{ status?: string; told?: boolean; noticePending?: boolean }>
    return entries.some((entry) => entry.noticePending === true || (entry.status === "running" && entry.told !== true))
  } catch {
    return false
  }
}

const WATCHDOG_RECOVERY = /\[stall-watchdog\] (main session stalled|subagent stalled|main session ended on a stream timeout)/

/** Stall-watchdog recoveries in a slice of the plugin log (`$TMPDIR/oh-my-opencode.log` of the sandbox). */
export function countWatchdogRecoveries(logText: string): number {
  return logText.split("\n").filter((line) => WATCHDOG_RECOVERY.test(line)).length
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function readFrom(path: string, offset: number): string {
  try {
    return readFileSync(path).subarray(offset).toString("utf8")
  } catch {
    return ""
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

/** Pending permissions answered during a run: request id → what was asked. */
type RunStats = { readonly permissions: Map<string, string> }

/** Runs the task once and returns the transcript of the evaluated session (the subagent's, in subtask mode). */
async function execute(client: Client, task: Task, workdir: string, stats: RunStats): Promise<Transcript> {
  const session = await client.session.create({ title: `bench ${task.id}` })
  const parentID = (session.data as { id?: string } | undefined)?.id
  if (parentID === undefined) throw new Error(`server error creating session: ${JSON.stringify(session.error ?? {}).slice(0, 200)}`)
  if (task.mode === "primary") {
    await client.session.promptAsync({ sessionID: parentID, agent: task.agent, parts: [{ type: "text", text: task.prompt }] })
    try {
      // The session reads idle until the agent picks the prompt up: wait for it to start before waiting for idle,
      // or the run ends (and is aborted) before any work happens.
      await waitForStart(client, parentID, task.id)
      const quiet = createIdleDebounce(IDLE_SETTLE_MS)
      await waitUntil(async () => {
        const asked = (await answerQuestions(client)) + (await answerPermissions(client, stats.permissions))
        const idle = asked === 0 && (await isIdle(client, parentID)) && !managedProcessesBusy(workdir)
        return quiet.settled(idle)
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
      await answerPermissions(client, stats.permissions)
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

/** Informational: how many permission prompts the run hit (each one would have blocked a real user's agent). */
export function permissionsInfo(permissions: ReadonlyMap<string, string>): GradeResult {
  const asked = [...permissions.values()]
  const detail = `${asked.length} permission wait(s), auto-approved once${asked.length > 0 ? `: ${asked.slice(0, 5).join("; ")}${asked.length > 5 ? "; …" : ""}` : ""}`
  return { name: "info:permissions", pass: true, detail }
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
  const stats: RunStats = { permissions: new Map() }
  const logPath = join(options.sandbox.env.TMPDIR ?? join(options.sandbox.root, "tmp"), "oh-my-opencode.log")
  const logOffset = fileSize(logPath)
  // Measured while the run happens, so `regrade.ts` keeps them (RUNTIME_INFO_GRADES); they never fail a run.
  const runtimeInfo = (): GradeResult[] => [
    permissionsInfo(stats.permissions),
    { name: "info:recoveries", pass: true, detail: `${countWatchdogRecoveries(readFrom(logPath, logOffset))} stall-watchdog recovery(ies)` },
  ]
  let transcript: Transcript
  try {
    const client = createOpencodeClient({ baseUrl: options.baseUrl, directory: workdir })
    transcript = await execute(client, task, workdir, stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = classifyFailure(message)
    return { ...base, ...(failure === "task" ? { pass: false } : {}), failure, grades: runtimeInfo(), error: message }
  }
  if (transcript.error !== undefined && classifyFailure(transcript.error) === "infra") {
    return { ...base, failure: "infra", grades: runtimeInfo(), transcript, error: transcript.error }
  }
  const context: GradeContext = { transcript, workdir, ...(options.fetchStatus ? { fetchStatus: options.fetchStatus } : {}) }
  const grades = [...(await Promise.all(gradersFor(task).map((grader) => grader.grade(context)))), ...runtimeInfo()]
  const pass = transcript.error === undefined && grades.every((grade) => grade.pass)
  return { ...base, pass, ...(pass ? {} : { failure: "task" as const }), grades, transcript, ...(transcript.error === undefined ? {} : { error: transcript.error }) }
}
