/** What a managed process is waited on before the agent is told (fork roadmap 0.8b). */
import { connect } from "node:net"

import { createMonitorFilter } from "../monitor/filter"

export type WaitFor =
  | { readonly kind: "exit" }
  | { readonly kind: "pattern"; readonly source: string; matches(line: string): boolean }
  | { readonly kind: "port"; readonly port: number; readonly host: string }

export type WaitForInput = "exit" | { pattern: string } | { port: number; host?: string } | undefined

export function parseWaitFor(input: WaitForInput): WaitFor {
  if (input === undefined || input === "exit") return { kind: "exit" }
  if ("pattern" in input) {
    const result = createMonitorFilter(input.pattern, { patternMaxLength: 512 })
    if (!result.filter) throw new Error(`wait_for.pattern: ${result.error}`)
    const filter = result.filter
    return { kind: "pattern", source: input.pattern, matches: (line) => filter.matches(line) }
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) throw new Error("wait_for.port must be 1-65535")
  return { kind: "port", port: input.port, host: input.host ?? "127.0.0.1" }
}

/** True when something accepts TCP connections on host:port (works the same on Windows and Linux). */
export function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}
