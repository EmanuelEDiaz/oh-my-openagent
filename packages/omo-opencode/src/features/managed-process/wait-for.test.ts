import { describe, expect, test } from "bun:test"
import { createServer } from "node:net"

import { isPortOpen, parseWaitFor } from "./wait-for"

describe("parseWaitFor (fork 0.8b)", () => {
  test("accepts exit, a pattern or a port; defaults to exit", () => {
    expect(parseWaitFor(undefined)).toEqual({ kind: "exit" })
    expect(parseWaitFor("exit")).toEqual({ kind: "exit" })
    expect(parseWaitFor({ pattern: "ready on \\d+" })).toMatchObject({ kind: "pattern" })
    expect(parseWaitFor({ port: 3000 })).toEqual({ kind: "port", port: 3000, host: "127.0.0.1" })
  })

  test("rejects invalid or dangerous patterns", () => {
    expect(() => parseWaitFor({ pattern: "(a+)+$" })).toThrow()
    expect(() => parseWaitFor({ port: 70000 })).toThrow()
  })
})

describe("isPortOpen", () => {
  test("detects a listening port and a closed one", async () => {
    const server = createServer().listen(0, "127.0.0.1")
    await new Promise((resolve) => server.once("listening", resolve))
    const port = (server.address() as { port: number }).port
    expect(await isPortOpen("127.0.0.1", port)).toBe(true)
    server.close()
    await new Promise((resolve) => server.once("close", resolve))
    expect(await isPortOpen("127.0.0.1", port)).toBe(false)
  })
})
