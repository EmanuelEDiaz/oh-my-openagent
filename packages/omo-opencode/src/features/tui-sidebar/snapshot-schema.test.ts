import { describe, expect, it } from "bun:test"

import { MIRROR_SCHEMA_VERSION } from "./constants"
import { parseSnapshot, TuiRuntimeSnapshotSchema } from "./snapshot-schema"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"

describe("TuiRuntimeSnapshotSchema", () => {
  it("#given a valid snapshot #when parsed #then it round-trips the typed value", () => {
    // given
    const snapshot: TuiRuntimeSnapshot = {
      version: MIRROR_SCHEMA_VERSION,
      projectDir: "/tmp/project",
      updatedAt: 1_718_000_000,
      activeAgents: [
        { name: "sisyphus", status: "running" },
        { name: "atlas", status: "retry" },
      ],
      jobBoard: [
        {
          title: "Index repository",
          status: "running",
          toolCalls: 3,
          lastTool: "grep",
        },
      ],
      loop: {
        kind: "live",
        goalsDone: 2,
        goalsTotal: 4,
        pass: 5,
        fail: 1,
        pending: 3,
        blocked: 1,
        activeGoal: "Render sidebar",
      },
    }

    // when
    const parsed = parseSnapshot(snapshot)
    const schemaParsed = TuiRuntimeSnapshotSchema.parse(snapshot)

    // then
    expect(parsed).toEqual(snapshot)
    expect(schemaParsed).toEqual(snapshot)
  })

  it("#given a version mismatch #when parsed #then it returns null", () => {
    // given
    const raw = {
      version: 2,
      projectDir: "/tmp/project",
      updatedAt: 1,
      activeAgents: [],
      jobBoard: [],
      loop: null,
    }

    // when
    const parsed = parseSnapshot(raw)

    // then
    expect(parsed).toBeNull()
  })

  it("#given a snapshot without projectDir #when parsed #then it returns null", () => {
    // given
    const raw = {
      version: MIRROR_SCHEMA_VERSION,
      updatedAt: 1,
      activeAgents: [],
      jobBoard: [],
      loop: null,
    }

    // when
    const parsed = parseSnapshot(raw)

    // then
    expect(parsed).toBeNull()
  })

  it("#given a non-object value #when parsed #then it returns null", () => {
    // given
    const raw = "not a snapshot"

    // when
    const parsed = parseSnapshot(raw)

    // then
    expect(parsed).toBeNull()
  })

  it("#given a snapshot with a network wait #when parsed #then the connection round-trips", () => {
    // given
    const snapshot: TuiRuntimeSnapshot = {
      version: MIRROR_SCHEMA_VERSION,
      projectDir: "/tmp/project",
      updatedAt: 1,
      activeAgents: [],
      jobBoard: [],
      loop: null,
      connection: { state: "offline", attempt: 3, limit: 12, nextAt: 1_718_000_015, since: 1_718_000_000 },
    }

    // when
    const parsed = parseSnapshot(snapshot)

    // then
    expect(parsed).toEqual(snapshot)
  })

  it("#given a mirror written without a connection #when parsed #then it still parses with no connection", () => {
    // given
    const raw = { version: MIRROR_SCHEMA_VERSION, projectDir: "/tmp/project", updatedAt: 1, activeAgents: [], jobBoard: [], loop: null }

    // when
    const parsed = parseSnapshot(raw)

    // then
    expect(parsed).not.toBeNull()
    expect(parsed?.connection).toBeUndefined()
  })

  it("#given an unknown connection state #when parsed #then it returns null", () => {
    // given
    const raw = {
      version: MIRROR_SCHEMA_VERSION,
      projectDir: "/tmp/project",
      updatedAt: 1,
      activeAgents: [],
      jobBoard: [],
      loop: null,
      connection: { state: "flaky", attempt: null, limit: null, nextAt: null, since: null },
    }

    // when
    const parsed = parseSnapshot(raw)

    // then
    expect(parsed).toBeNull()
  })
})
