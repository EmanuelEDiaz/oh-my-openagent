import { afterEach, describe, expect, test } from "bun:test"

import { disposeWorkdirInstance } from "./dispose-instance"

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => server?.stop(true))

describe("disposeWorkdirInstance (fork incidents H4)", () => {
  test("#given a finished task #when its folder is cleaned up #then OpenCode is asked to dispose that folder's instance", async () => {
    // given: a stand-in OpenCode server that records the request
    const seen: string[] = []
    server = Bun.serve({ port: 0, fetch: (request) => (seen.push(`${request.method} ${new URL(request.url).pathname} ${new URL(request.url).searchParams.get("directory")}`), Response.json(true)) })

    // when
    const disposed = await disposeWorkdirInstance(`http://127.0.0.1:${server.port}`, "/tmp/work/task-a")

    // then
    expect(disposed).toBe(true)
    expect(seen).toEqual(["POST /instance/dispose /tmp/work/task-a"])
  })

  test("#given the server is gone #then cleanup goes on without throwing", async () => {
    expect(await disposeWorkdirInstance("http://127.0.0.1:1", "/tmp/work/task-b")).toBe(false)
  })
})
