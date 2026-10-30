// Test LSP server that behaves like typescript-language-server on a cold start (fork incidents H22): no pull
// diagnostics; after didOpen it reports work-done progress while the project loads, and publishes only when done.
// BUSY_MS sets how long it stays busy; ADVERTISED_PROGRESS=0 simulates a client that did not ask for progress.
const busyMs = Number(process.env.BUSY_MS ?? "1500")
// Real typescript-language-server ends its progress ~100 ms before it publishes.
const publishAfterEndMs = Number(process.env.PUBLISH_AFTER_END_MS ?? "0")
// Under load the real server announces its progress only seconds after didOpen.
const progressDelayMs = Number(process.env.PROGRESS_DELAY_MS ?? "0")
let buffer = Buffer.alloc(0)
let clientAcceptsProgress = false
const send = (message) => {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n")
    if (headerEnd < 0) return
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1] ?? 0)
    if (buffer.length < headerEnd + 4 + length) return
    const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString())
    buffer = buffer.subarray(headerEnd + 4 + length)
    handle(message)
  }
})
function handle(message) {
  if (message.method === "initialize") {
    clientAcceptsProgress = message.params?.capabilities?.window?.workDoneProgress === true
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { textDocumentSync: 1 } } })
  } else if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null })
  } else if (message.method === "exit") {
    process.exit(0)
  } else if (message.method === "textDocument/didOpen") {
    const uri = message.params.textDocument.uri
    setTimeout(() => {
      if (!clientAcceptsProgress) return
      send({ jsonrpc: "2.0", id: "progress-1", method: "window/workDoneProgress/create", params: { token: "load" } })
      send({ jsonrpc: "2.0", method: "$/progress", params: { token: "load", value: { kind: "begin", title: "Initializing" } } })
    }, progressDelayMs)
    setTimeout(() => {
      if (clientAcceptsProgress) send({ jsonrpc: "2.0", method: "$/progress", params: { token: "load", value: { kind: "end" } } })
      setTimeout(() => send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "Type 'number' is not assignable to type 'string'.", severity: 1, code: 2322 }] },
      }), publishAfterEndMs)
    }, busyMs)
  } else if (message.id !== undefined && message.method) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unhandled method ${message.method}` } })
  }
}
