import { PassThrough } from "node:stream";

import { describe, expect, it } from "bun:test";

import { JsonRpcConnection } from "./json-rpc-connection.js";

// Fork incidents H17 (19-10-2026): a language server that exits at startup closed its stdout, but the pending
// `initialize` waited for its 60 s timeout (30 s through the daemon), and post-edit diagnostics of every other file in
// the same batch were lost with it.
describe("JsonRpcConnection when the server's output closes", () => {
	it("#given a pending request #when the reader closes #then the request is rejected at once", async () => {
		const reader = new PassThrough();
		const writer = new PassThrough();
		const connection = new JsonRpcConnection(reader, writer);
		connection.listen();
		const started = Date.now();

		const pending = connection.sendRequest("initialize", {});
		reader.end();

		await expect(pending).rejects.toThrow(/connection closed/i);
		expect(Date.now() - started).toBeLessThan(1000);
		expect(connection.pendingRequestCount()).toBe(0);
	});

	it("#given a closed reader #when a new request is sent #then it fails instead of waiting", async () => {
		const reader = new PassThrough();
		const writer = new PassThrough();
		const connection = new JsonRpcConnection(reader, writer);
		connection.listen();
		reader.end();
		await new Promise((resolve) => setTimeout(resolve, 10));

		await expect(connection.sendRequest("textDocument/diagnostic", {})).rejects.toThrow(/connection closed|disposed/i);
	});
});
