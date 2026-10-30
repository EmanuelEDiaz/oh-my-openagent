import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { probeLanguageServer } from "./server-probe.js"

// Fork 0.25 (21-10-2026): a server binary on PATH is not a working server (typescript-language-server installs fine and
// cannot start on TypeScript 7). The probe starts it and requires the LSP handshake.
const dirs: string[] = []
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fakeServer(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), "omo-probe-"))
	dirs.push(dir)
	const file = join(dir, "server.mjs")
	writeFileSync(file, body)
	return file
}

const ANSWERS = `
let buffer = ""
const send = (message) => { const text = JSON.stringify(message); process.stdout.write("Content-Length: " + Buffer.byteLength(text) + "\\r\\n\\r\\n" + text) }
process.stdin.on("data", (chunk) => {
  buffer += chunk
  for (;;) {
    const header = buffer.indexOf("\\r\\n\\r\\n"); if (header === -1) return
    const length = Number(/Content-Length: (\\d+)/.exec(buffer.slice(0, header))[1])
    if (buffer.length < header + 4 + length) return
    const message = JSON.parse(buffer.slice(header + 4, header + 4 + length)); buffer = buffer.slice(header + 4 + length)
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message: 'Using Typescript version (workspace) 6.0.3 from path "/x/tsserver.js"' } })
      send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } })
    } else if (message.method === "shutdown") send({ jsonrpc: "2.0", id: message.id, result: null })
    else if (message.method === "exit") process.exit(0)
  }
})
`

describe("probeLanguageServer", () => {
	test("#given a server that answers the handshake #then it connects and reports the TypeScript it loaded", async () => {
		const server = { id: "typescript", command: [process.execPath, fakeServer(ANSWERS)], extensions: [".ts"], priority: 0 }
		const result = await probeLanguageServer(tmpdir(), server, 5000)
		expect(result).toMatchObject({ status: "connects", typescriptVersion: "6.0.3" })
	})

	test("#given a server that dies on start #then it fails and says why", async () => {
		const server = { id: "typescript", command: [process.execPath, fakeServer(`console.error("Could not find a valid TypeScript installation"); process.exit(1)`)], extensions: [".ts"], priority: 0 }
		const result = await probeLanguageServer(tmpdir(), server, 5000)
		expect(result.status).toBe("fails")
		expect("detail" in result ? result.detail : "").toContain("Could not find a valid TypeScript installation")
	})

	test("#given a server that never answers #then it fails at the deadline instead of hanging", async () => {
		const server = { id: "other", command: [process.execPath, fakeServer(`setInterval(() => {}, 1000)`)], extensions: [".x"], priority: 0 }
		const result = await probeLanguageServer(tmpdir(), server, 800)
		expect(result.status).toBe("fails")
		expect(result.ms).toBeLessThan(5000)
	})
})
