import { HEARTBEAT_MS, WRITE_DEBOUNCE_MS } from "./constants"
import { log } from "../../shared/logger"
import { onNetworkGuardChange } from "../network-guard"
import { snapshotIsActive, writeMirror } from "./mirror-io"
import { buildTuiRuntimeSnapshot } from "./snapshot-builder"
import type {
  BuildTuiRuntimeSnapshotInput,
  SessionAgentResolver,
  SessionStatusMap,
  TuiBackgroundSnapshotProvider,
  TuiMirrorClient,
} from "./snapshot-builder"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"

export type TuiStateMirrorInput = {
  readonly client: TuiMirrorClient
  readonly projectDir: string
  readonly backgroundManager: TuiBackgroundSnapshotProvider
  readonly getStatuses?: () => Promise<SessionStatusMap>
  readonly sessionAgentResolver?: SessionAgentResolver
  readonly reportFlushError?: (error: Error) => void
  readonly getConnectionViews?: BuildTuiRuntimeSnapshotInput["getConnectionViews"]
  /** Calls `listener` when the network guard state changes; returns the unsubscribe. */
  readonly subscribeConnection?: (listener: () => void) => () => void
}

export class TuiStateMirror {
  private readonly snapshotInput: BuildTuiRuntimeSnapshotInput
  private readonly reportFlushError: (error: Error) => void
  private heartbeatID: ReturnType<typeof setInterval> | null = null
  private debounceID: ReturnType<typeof setTimeout> | null = null
  private pendingFlush: Promise<void> | null = null
  private resolvePendingFlush: (() => void) | null = null
  private inFlightFlush: Promise<void> | null = null
  private stopped = false
  private readonly subscribeConnection: (listener: () => void) => () => void
  private unsubscribeConnection: (() => void) | null = null

  constructor(input: TuiStateMirrorInput) {
    this.snapshotInput = input
    this.subscribeConnection = input.subscribeConnection ?? onNetworkGuardChange
    this.reportFlushError = input.reportFlushError ?? ((error) => log("[tui-sidebar] mirror flush failed", { error }))
  }

  buildSnapshot(): Promise<TuiRuntimeSnapshot> {
    return buildTuiRuntimeSnapshot(this.snapshotInput)
  }

  flush(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }

    if (this.pendingFlush) {
      return this.pendingFlush
    }

    const scheduledFlush = new Promise<void>((resolvePromise, rejectPromise) => {
      this.resolvePendingFlush = resolvePromise
      this.debounceID = setTimeout(() => {
        this.debounceID = null
        this.resolvePendingFlush = null
        this.runFlush().then(resolvePromise, rejectPromise)
      }, WRITE_DEBOUNCE_MS)
    })

    this.pendingFlush = scheduledFlush.then(
      () => {
        this.pendingFlush = null
      },
      (error: unknown) => {
        this.pendingFlush = null
        throw error
      },
    )
    return this.pendingFlush
  }

  onEvent(_event: unknown): void {
    void this.flush()
  }

  /** Writes the current state once; the heartbeat then runs only while something is in progress. */
  start(): void {
    this.stopped = false
    // A network wait starts or ends between OpenCode events (the guard probes on its own timers).
    this.unsubscribeConnection ??= this.subscribeConnection(() => {
      void this.flush()
    })
    void this.flush()
  }

  private setHeartbeat(active: boolean): void {
    if (active && this.heartbeatID === null && !this.stopped) {
      this.heartbeatID = setInterval(() => {
        void this.flush()
      }, HEARTBEAT_MS)
      this.heartbeatID.unref?.()
    } else if (!active && this.heartbeatID !== null) {
      clearInterval(this.heartbeatID)
      this.heartbeatID = null
    }
  }

  stop(): void {
    this.stopped = true
    this.unsubscribeConnection?.()
    this.unsubscribeConnection = null
    if (this.heartbeatID !== null) {
      clearInterval(this.heartbeatID)
      this.heartbeatID = null
    }
    if (this.debounceID !== null) {
      clearTimeout(this.debounceID)
      this.debounceID = null
    }
    if (this.resolvePendingFlush) {
      this.resolvePendingFlush()
      this.resolvePendingFlush = null
    }
    this.pendingFlush = null
  }

  private runFlush(): Promise<void> {
    if (this.inFlightFlush) {
      return this.inFlightFlush
    }

    const runningFlush = this.writeSnapshotNoThrow()
    this.inFlightFlush = runningFlush.then(
      () => {
        this.inFlightFlush = null
      },
      (error: unknown) => {
        this.inFlightFlush = null
        throw error
      },
    )
    return this.inFlightFlush
  }

  private async writeSnapshotNoThrow(): Promise<void> {
    try {
      const snapshot = await this.buildSnapshot()
      if (this.stopped) {
        return
      }
      writeMirror(this.snapshotInput.projectDir, snapshot)
      this.setHeartbeat(snapshotIsActive(snapshot))
    } catch (error) {
      if (error instanceof Error) {
        this.reportFlushError(error)
        return
      }
      throw error
    }
  }
}
