import { getLastAgentFromSession } from "../../hooks/atlas/session-last-agent"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { getNetworkGuard } from "../network-guard"
import type { NetworkGuardSessionView } from "../network-guard"
import { MIRROR_SCHEMA_VERSION } from "./constants"
import { readActiveLoop } from "./loop-reader"
import { canonicalProjectDir } from "./mirror-path"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"
import type { AgentStatus, ConnectionSnapshot, JobRow } from "./state-types"
import type { BackgroundTaskSnapshot } from "../background-agent/types"

export type TuiMirrorClient = {
  readonly session: {
    readonly status: () => Promise<unknown>
    readonly messages: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

export type SessionStatusRow = {
  readonly type: string
}

export type SessionStatusMap = Record<string, SessionStatusRow>

export type TuiBackgroundSnapshotProvider = {
  readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[]
}

export type SessionAgentResolver = (sessionID: string, client: TuiMirrorClient) => Promise<string | null>

export type BuildTuiRuntimeSnapshotInput = {
  readonly client: TuiMirrorClient
  readonly projectDir: string
  readonly backgroundManager: TuiBackgroundSnapshotProvider
  readonly getStatuses?: () => Promise<SessionStatusMap>
  readonly sessionAgentResolver?: SessionAgentResolver
  /** Sessions waiting on the network; defaults to the running network guard. */
  readonly getConnectionViews?: () => readonly NetworkGuardSessionView[] | undefined
}

type ActiveAgentStatus = Extract<AgentStatus, "busy" | "retry" | "running">

export async function buildTuiRuntimeSnapshot(
  input: BuildTuiRuntimeSnapshotInput,
): Promise<TuiRuntimeSnapshot> {
  const statuses = await readStatuses(input)
  const loop = readActiveLoop(input.projectDir)
  const connection = connectionFromGuard((input.getConnectionViews ?? defaultConnectionViews)() ?? [])

  return {
    version: MIRROR_SCHEMA_VERSION,
    projectDir: canonicalProjectDir(input.projectDir),
    updatedAt: Date.now(),
    activeAgents: await activeAgentsFromStatuses(statuses, input.client, input.sessionAgentResolver ?? getLastAgentFromSession),
    jobBoard: input.backgroundManager.getTasksSnapshot().map(toJobRow),
    loop: loop.kind === "live" ? redactLoopText(loop) : null,
    ...(connection ? { connection } : {}),
  }
}

function defaultConnectionViews(): readonly NetworkGuardSessionView[] | undefined {
  return getNetworkGuard()?.snapshot()
}

/** One line for the whole sidebar: a guard probe cycle first, then OpenCode's own retry, then a freeze. */
export function connectionFromGuard(views: readonly NetworkGuardSessionView[]): ConnectionSnapshot | null {
  const probing = views.find((view) => view.phase === "offline")
  if (probing) {
    const waiting = probing.nextAt !== undefined
    return {
      state: probing.verdict === "provider-down" ? "provider-down" : "offline",
      // While waiting the toast announces the next probe, so the line does too.
      attempt: probing.attempt === undefined ? null : probing.attempt + (waiting ? 1 : 0),
      limit: probing.limit,
      nextAt: probing.nextAt ?? null,
      since: probing.since ?? null,
    }
  }
  const retrying = views.find((view) => view.phase === "retrying")
  if (retrying) {
    return {
      state: "offline",
      attempt: retrying.attempt ?? null,
      // OpenCode's retry has no limit known to the guard.
      limit: null,
      nextAt: retrying.nextAt ?? null,
      since: retrying.since ?? null,
    }
  }
  if (views.some((view) => view.frozenSeconds !== undefined)) {
    return { state: "frozen", attempt: null, limit: null, nextAt: null, since: null }
  }
  return null
}

async function readStatuses(input: BuildTuiRuntimeSnapshotInput): Promise<SessionStatusMap> {
  if (input.getStatuses) {
    return input.getStatuses()
  }

  const response = await input.client.session.status()
  return normalizeSDKResponse<SessionStatusMap>(response, {})
}

async function activeAgentsFromStatuses(
  statuses: SessionStatusMap,
  client: TuiMirrorClient,
  sessionAgentResolver: SessionAgentResolver,
): Promise<TuiRuntimeSnapshot["activeAgents"]> {
  const rows = Object.entries(statuses)
    .map(([sessionID, row]) => ({ sessionID, status: activeStatus(row.type) }))
    .filter((row): row is { readonly sessionID: string; readonly status: ActiveAgentStatus } => row.status !== null)

  return Promise.all(
    rows.map(async (row) => ({
      name: (await sessionAgentResolver(row.sessionID, client)) ?? row.sessionID,
      status: row.status,
    })),
  )
}

function activeStatus(status: string): ActiveAgentStatus | null {
  switch (status) {
    case "busy":
    case "retry":
    case "running":
      return status
    default:
      return null
  }
}

function toJobRow(task: BackgroundTaskSnapshot): JobRow {
  return {
    title: task.title || `${task.agent} background task`,
    status: task.status,
    toolCalls: task.toolCalls,
    lastTool: task.lastTool,
  }
}

function redactLoopText(loop: TuiRuntimeSnapshot["loop"]): TuiRuntimeSnapshot["loop"] {
  if (loop === null) {
    return null
  }
  return { ...loop, activeGoal: null }
}
