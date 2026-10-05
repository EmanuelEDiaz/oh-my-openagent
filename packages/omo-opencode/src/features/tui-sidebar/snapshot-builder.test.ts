import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { LOOP_FRESH_MS } from "./constants"
import { buildTuiRuntimeSnapshot, connectionFromGuard } from "./snapshot-builder"
import { TuiRuntimeSnapshotSchema } from "./snapshot-schema"
import type { SessionAgentResolver } from "./snapshot-builder"
import type { BackgroundTaskSnapshot } from "../background-agent/types"
import type { NetworkGuardSessionView } from "../network-guard"

type StatusRow = { readonly type: string }
type StatusMap = Record<string, StatusRow>

type FakeClient = {
  readonly session: {
    readonly status: () => Promise<{ readonly data: StatusMap }>
    readonly messages: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

type FakeBackgroundManager = {
  readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[]
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-tui-snapshot-builder-${label}-`))
  tempDirs.push(dir)
  return dir
}

function writeLiveLoop(projectDir: string): void {
  const filePath = join(projectDir, ".omo", "ulw-loop", "current", "goals.json")
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      activeGoalId: "ship",
      goals: [
        {
          id: "ship",
          title: "Ship mirror",
          status: "in_progress",
          successCriteria: [{ status: "pass" }, { status: "fail" }],
        },
      ],
    }),
  )
}

function writeSensitiveLiveLoop(projectDir: string): void {
  const filePath = join(projectDir, ".omo", "ulw-loop", "current", "goals.json")
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      activeGoalId: "secret",
      goals: [
        {
          id: "secret",
          title: "Deploy with token sk-live-secret",
          status: "in_progress",
          successCriteria: [{ status: "pending" }],
        },
      ],
    }),
  )
}

function createClient(statuses: StatusMap): FakeClient {
  return {
    session: {
      status: async () => ({ data: statuses }),
      messages: async () => ({ data: [] }),
    },
  }
}

function createBackgroundManager(tasks: readonly BackgroundTaskSnapshot[]): FakeBackgroundManager {
  return {
    getTasksSnapshot: () => tasks,
  }
}

const resolveTestSessionAgent: SessionAgentResolver = async (sessionID) => {
  switch (sessionID) {
    case "ses-main":
      return "sisyphus"
    case "ses-sub":
      return "atlas"
    default:
      return null
  }
}

describe("buildTuiRuntimeSnapshot", () => {
  beforeEach(() => {
    makeTempDir("isolation")
  })

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given SDK data statuses background jobs and a live loop #when building #then it returns a schema-valid runtime snapshot", async () => {
    // given
    const projectDir = makeTempDir("schema-project")
    writeLiveLoop(projectDir)

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({
        "ses-main": { type: "busy" },
        "ses-idle": { type: "idle" },
        "ses-sub": { type: "retry" },
      }),
      backgroundManager: createBackgroundManager([
        {
          title: "Explore runtime",
          status: "running",
          toolCalls: 3,
          lastTool: "grep",
          agent: "sisyphus",
        },
      ]),
      sessionAgentResolver: resolveTestSessionAgent,
    })

    // then
    expect(TuiRuntimeSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.projectDir).toBe(realpathSync.native(resolve(projectDir)))
    expect(snapshot.activeAgents).toEqual([
      { name: "sisyphus", status: "busy" },
      { name: "atlas", status: "retry" },
    ])
    expect(snapshot.jobBoard).toEqual([
      { title: "Explore runtime", status: "running", toolCalls: 3, lastTool: "grep" },
    ])
    expect(snapshot.loop).toEqual({
      kind: "live",
      goalsDone: 0,
      goalsTotal: 1,
      pass: 1,
      fail: 1,
      pending: 0,
      blocked: 0,
      activeGoal: null,
    })
    expect(Date.now() - snapshot.updatedAt).toBeLessThan(LOOP_FRESH_MS)
  })

  it("#given no session agent is available #when building #then it uses the session id fallback explicitly", async () => {
    // given
    const projectDir = makeTempDir("fallback-project")

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: {
        session: {
          status: async () => ({ data: { "ses-fallback": { type: "running" } } }),
          messages: async () => ({ data: [] }),
        },
      },
      backgroundManager: createBackgroundManager([]),
    })

    // then
    expect(snapshot.activeAgents).toEqual([{ name: "ses-fallback", status: "running" }])
  })

  it("#given prompt-derived task and loop titles #when building #then persisted mirror text is redacted", async () => {
    // given
    const projectDir = makeTempDir("sensitive-text")
    writeSensitiveLiveLoop(projectDir)

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([
        {
          title: "atlas background task",
          status: "running",
          toolCalls: 1,
          lastTool: "read",
          agent: "atlas",
        },
      ]),
      sessionAgentResolver: resolveTestSessionAgent,
    })

    // then
    expect(snapshot.loop?.activeGoal).toBeNull()
    expect(snapshot.jobBoard).toEqual([
      { title: "atlas background task", status: "running", toolCalls: 1, lastTool: "read" },
    ])
    expect(JSON.stringify(snapshot)).not.toContain("sk-live")
  })

  it("#given a fake guard waiting between probes #when building #then the snapshot carries the next attempt and time", async () => {
    // given
    const projectDir = makeTempDir("connection")
    const views: NetworkGuardSessionView[] = [
      { sessionID: "ses-main", phase: "offline", attempt: 2, limit: 12, verdict: "offline", nextAt: 5_000, since: 1_000 },
    ]

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([]),
      getConnectionViews: () => views,
    })

    // then
    expect(TuiRuntimeSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.connection).toEqual({ state: "offline", attempt: 3, limit: 12, nextAt: 5_000, since: 1_000 })
  })

  it("#given no guard or an online guard #when building #then the snapshot has no connection key", async () => {
    // given
    const projectDir = makeTempDir("online")

    // when
    const withoutGuard = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([]),
      getConnectionViews: () => undefined,
    })
    const online = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([]),
      getConnectionViews: () => [],
    })

    // then
    expect("connection" in withoutGuard).toBe(false)
    expect("connection" in online).toBe(false)
  })
})

describe("connectionFromGuard", () => {
  it("#given a probe in flight with the provider down #when mapping #then it shows the running attempt and no wait", () => {
    expect(connectionFromGuard([{ sessionID: "s", phase: "offline", attempt: 2, limit: 12, verdict: "provider-down", since: 10 }]))
      .toEqual({ state: "provider-down", attempt: 2, limit: 12, nextAt: null, since: 10 })
  })

  it("#given OpenCode retrying and a guard cycle #when mapping #then the guard cycle wins", () => {
    const views: NetworkGuardSessionView[] = [
      { sessionID: "a", phase: "retrying", attempt: 4, limit: 12, nextAt: 99, since: 1 },
      { sessionID: "b", phase: "offline", attempt: 0, limit: 12, since: 5 },
    ]
    expect(connectionFromGuard(views)).toEqual({ state: "offline", attempt: 0, limit: 12, nextAt: null, since: 5 })
  })

  it("#given only OpenCode retrying #when mapping #then it shows its attempt without a limit", () => {
    expect(connectionFromGuard([{ sessionID: "a", phase: "retrying", attempt: 4, limit: 12, nextAt: 99, since: 1 }]))
      .toEqual({ state: "offline", attempt: 4, limit: null, nextAt: 99, since: 1 })
  })

  it("#given a session resumed after a freeze #when mapping #then it reports frozen", () => {
    expect(connectionFromGuard([{ sessionID: "a", phase: "online", limit: 12, frozenSeconds: 40 }]))
      .toEqual({ state: "frozen", attempt: null, limit: null, nextAt: null, since: null })
  })

  it("#given nothing waits #when mapping #then it returns null", () => {
    expect(connectionFromGuard([])).toBeNull()
  })
})
