import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import * as token from "../src/auth/token"
import { HttpClient } from "../src/http/client"

const SRC = join(import.meta.dir, "../src")

test("hidden: bearerHeader takes the token", () => {
  const bearerHeader = token.bearerHeader as unknown as (value: string) => Record<string, string>
  expect(bearerHeader("t1")).toEqual({ Authorization: "Bearer t1" })
  expect(bearerHeader("")).toEqual({})
})

test("hidden: the client sends the token it was given, not the environment's", async () => {
  delete process.env.API_TOKEN
  const seen: Array<Record<string, string>> = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
    seen.push(init?.headers ?? {})
    return new Response("{}", { status: 200 })
  }) as unknown as typeof fetch
  try {
    const Client = HttpClient as unknown as new (baseUrl: string, token: string) => HttpClient
    await new Client("http://upstream.test", "t2").get("/x")
  } finally {
    globalThis.fetch = realFetch
  }
  expect(seen[0]).toEqual({ Authorization: "Bearer t2" })
})

test("hidden: only config.ts reads API_TOKEN", () => {
  const files = readdirSync(SRC, { recursive: true }).map(String).filter((file) => file.endsWith(".ts"))
  expect(files.filter((file) => readFileSync(join(SRC, file), "utf8").includes("API_TOKEN"))).toEqual(["config.ts"])
})
