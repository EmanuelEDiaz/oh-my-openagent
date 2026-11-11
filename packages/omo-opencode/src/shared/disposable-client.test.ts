import { describe, expect, it, mock } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"

import { fenceClientAfterDispose, PluginInstanceDisposedError } from "./disposable-client"

function countingClient(): { client: ReturnType<typeof createOpencodeClient>; calls: string[] } {
  const calls: string[] = []
  const fetch = async (request: Request): Promise<Response> => {
    calls.push(new URL(request.url).pathname)
    return new Response("true", { status: 200, headers: { "content-type": "application/json" } })
  }
  return { client: createOpencodeClient({ baseUrl: "http://127.0.0.1:4096", directory: "/tmp/project", fetch }), calls }
}

describe("fenceClientAfterDispose", () => {
  describe("#given a fenced client", () => {
    it("#then requests reach the server until the fence closes", async () => {
      // given
      const { client, calls } = countingClient()
      const fence = fenceClientAfterDispose(client, mock(() => {}))

      // when
      await client.tui.showToast({ body: { message: "hi", variant: "info" } })

      // then
      expect(fence.fenced).toBe(true)
      expect(calls).toEqual(["/tui/show-toast"])
    })

    it("#then after closing, requests fail without reaching the server", async () => {
      // given
      const { client, calls } = countingClient()
      const log = mock(() => {})
      const fence = fenceClientAfterDispose(client, log)

      // when
      fence.close()
      const attempt = client.tui.showToast({ body: { message: "late", variant: "info" } })

      // then
      await expect(attempt).rejects.toBeInstanceOf(PluginInstanceDisposedError)
      expect(calls).toEqual([])
      expect(log).toHaveBeenCalledTimes(1)
    })

    it("#then only the first blocked request is logged", async () => {
      // given
      const { client } = countingClient()
      const log = mock(() => {})
      const fence = fenceClientAfterDispose(client, log)
      fence.close()

      // when
      await client.tui.showToast({ body: { message: "a", variant: "info" } }).catch(() => undefined)
      await client.tui.showToast({ body: { message: "b", variant: "info" } }).catch(() => undefined)

      // then
      expect(log).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given two instances sharing one internal client", () => {
    it("#then closing one never cuts the other; closing both does", async () => {
      // given
      const { client, calls } = countingClient()
      const first = fenceClientAfterDispose(client, mock(() => {}))
      const second = fenceClientAfterDispose(client, mock(() => {}))

      // when
      second.close()
      second.close()
      await client.tui.showToast({ body: { message: "still open", variant: "info" } })
      first.close()
      const late = client.tui.showToast({ body: { message: "late", variant: "info" } })

      // then
      await expect(late).rejects.toBeInstanceOf(PluginInstanceDisposedError)
      expect(calls).toEqual(["/tui/show-toast"])
    })
  })

  describe("#given a client without the SDK internals", () => {
    it("#then it is left alone", () => {
      // given
      const log = mock(() => {})

      // when
      const fence = fenceClientAfterDispose({}, log)
      fence.close()

      // then
      expect(fence.fenced).toBe(false)
    })
  })
})
