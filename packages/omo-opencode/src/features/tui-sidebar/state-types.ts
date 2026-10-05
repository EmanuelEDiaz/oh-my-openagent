import type { BackgroundTaskStatus } from "../background-agent/types"

export type AgentStatus = "busy" | "idle" | "error" | "running" | "retry"

export type AgentRow = {
  readonly name: string
  readonly status: AgentStatus
}

export type JobRow = {
  readonly title: string
  readonly status: BackgroundTaskStatus
  readonly toolCalls: number | null
  readonly lastTool: string | null
}

export type RosterRow = {
  readonly label: string
  readonly model: string
}

export type ConfigState =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly messages: readonly string[] }

export type RosterState =
  | { readonly kind: "empty" }
  | { readonly kind: "rows"; readonly rows: readonly RosterRow[] }

export type AgentsState =
  | { readonly kind: "none" }
  | { readonly kind: "list"; readonly agents: readonly AgentRow[] }

export type JobBoardState =
  | { readonly kind: "none" }
  | { readonly kind: "list"; readonly jobs: readonly JobRow[] }

export type LoopLive = {
  readonly kind: "live"
  readonly goalsDone: number
  readonly goalsTotal: number
  readonly pass: number
  readonly fail: number
  readonly pending: number
  readonly blocked: number
  readonly activeGoal: string | null
}

export type LoopState = { readonly kind: "none" } | LoopLive

/** Network guard state written by the server (fork roadmap 0.15). */
export type ConnectionSnapshot = {
  readonly state: "offline" | "provider-down" | "frozen"
  /** The probe (or OpenCode retry) shown: the next one while waiting, the running one while probing. */
  readonly attempt: number | null
  readonly limit: number | null
  /** When the next probe runs, epoch ms. */
  readonly nextAt: number | null
  /** When the wait started, epoch ms. */
  readonly since: number | null
}

export type ConnectionState =
  | { readonly kind: "none" }
  | {
      readonly kind: "offline" | "provider-down"
      readonly attempt: number | null
      readonly limit: number | null
      /** Whole seconds until the next probe, from the time the mirror was read. */
      readonly inS: number | null
    }
  | { readonly kind: "frozen" }

export type ConfigBanner =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }

export type SidebarView =
  | {
      readonly kind: "active"
      /** Absent in views built before the network guard existed: same as `{ kind: "none" }`. */
      readonly connection?: ConnectionState
      readonly loop: LoopState
      readonly agents: AgentsState
      readonly jobs: JobBoardState
      readonly configBanner: ConfigBanner
    }
  | { readonly kind: "broken"; readonly messages: readonly string[] }
  | { readonly kind: "idle"; readonly roster: RosterState }

export function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${JSON.stringify(value)}`)
}
