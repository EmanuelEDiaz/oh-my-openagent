/**
 * After OpenCode disposes a plugin instance, any request its client still sends makes OpenCode create the folder's
 * instance again, with a fresh plugin that nobody disposes (fork incident H53: a late startup toast grew the bench
 * server by ~30 MB per folder until the memory cap killed it). The fence cuts the client at its fetch, so every late
 * caller fails like an unreachable server, a path the code already handles.
 */
import { isRecord } from "@oh-my-opencode/utils"

export class PluginInstanceDisposedError extends Error {
  constructor(path: string) {
    super(`plugin instance disposed; request to ${path} not sent`)
    this.name = "PluginInstanceDisposedError"
  }
}

export type ClientFence = {
  /** False when the client has no SDK internals to fence (tests, unknown clients). */
  readonly fenced: boolean
  readonly close: () => void
}

type FenceState = { open: number; blocked: number }

type RequestFetch = (request: Request) => Promise<Response>

/** Instances sharing one internal client share one fence; it closes when the last of them is disposed. */
const fences = new WeakMap<object, FenceState>()

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname
  } catch {
    return String(request.url)
  }
}

export function fenceClientAfterDispose(
  client: unknown,
  log: (message: string, context?: Record<string, unknown>) => void,
): ClientFence {
  const internal = isRecord(client) ? client["_client"] : undefined
  if (!isRecord(internal) || typeof internal["getConfig"] !== "function" || typeof internal["setConfig"] !== "function") {
    return { fenced: false, close: () => {} }
  }
  let state = fences.get(internal)
  if (state === undefined) {
    const fenceState: FenceState = { open: 0, blocked: 0 }
    state = fenceState
    const config: unknown = internal["getConfig"]()
    const configured = isRecord(config) ? config["fetch"] : undefined
    const base: RequestFetch = typeof configured === "function"
      ? (request) => (configured as RequestFetch)(request)
      : (request) => globalThis.fetch(request)
    const fenced: RequestFetch = (request) => {
      if (fenceState.open > 0) return base(request)
      fenceState.blocked += 1
      if (fenceState.blocked === 1) log("[plugin-dispose] blocked a request from a disposed instance", { path: requestPath(request) })
      return Promise.reject(new PluginInstanceDisposedError(requestPath(request)))
    }
    internal["setConfig"]({ fetch: fenced })
    fences.set(internal, fenceState)
  }
  const shared = state
  shared.open += 1
  let closed = false
  return {
    fenced: true,
    close: () => {
      if (closed) return
      closed = true
      shared.open -= 1
    },
  }
}
