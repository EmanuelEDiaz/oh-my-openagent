import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { LspClient } from "./client.js";

// Fork incidents H22 (19-10-2026): typescript-language-server has no pull diagnostics and, on a cold start, reports
// "Initializing JS/TS language features" for ~5 s before its first publish. The 3 s freshness window then closed and
// the never-published rule returned "no errors" for a file with a type error.
const SERVER = join(import.meta.dir, "fixtures", "busy-progress-server.mjs");
const clients: LspClient[] = [];
const roots: string[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) await client.stop().catch(() => undefined);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function startClient(busyMs: number, freshnessMs: number, busyServerMaxWaitMs?: number, publishAfterEndMs = 0, progressDelayMs = 0) {
	const root = mkdtempSync(join(tmpdir(), "lsp-busy-"));
	roots.push(root);
	const file = join(root, "a.ts");
	writeFileSync(file, "export const a: string = 1\n");
	const client = new LspClient(
		root,
		{ id: "busy", command: [process.execPath, SERVER], extensions: [".ts"], priority: 0, env: { BUSY_MS: String(busyMs), PUBLISH_AFTER_END_MS: String(publishAfterEndMs), PROGRESS_DELAY_MS: String(progressDelayMs) } },
		{ diagnosticsFreshnessTimeoutMs: freshnessMs, ...(busyServerMaxWaitMs === undefined ? {} : { busyServerMaxWaitMs }) },
	);
	clients.push(client);
	await client.start();
	await client.initialize();
	return { client, file };
}

describe("LspClient diagnostics while the server reports it is busy", () => {
	it("#given a server still loading past the freshness window #when diagnostics are asked #then they wait for its publish instead of answering clean", async () => {
		const { client, file } = await startClient(1500, 300);
		const result = await client.diagnostics(file);
		expect(result.items.map((item) => item.code)).toEqual([2322]);
	});

	it("#given a server that ends its progress shortly before it publishes #when diagnostics are asked #then that publish is still awaited", async () => {
		const { client, file } = await startClient(1000, 300, undefined, 400);
		const result = await client.diagnostics(file);
		expect(result.items.map((item) => item.code)).toEqual([2322]);
	});

	it("#given a freshly started server that announces its work only after the window #when diagnostics are asked #then its silence is not taken as clean", async () => {
		const { client, file } = await startClient(1400, 300, undefined, 0, 700);
		const result = await client.diagnostics(file);
		expect(result.items.map((item) => item.code)).toEqual([2322]);
	});

	it("#given a server that stays busy #when the freshness window closes #then diagnostics keep waiting instead of answering clean", async () => {
		const { client, file } = await startClient(60_000, 300);
		const outcome = await Promise.race([
			client.diagnostics(file).then(() => "answered"),
			new Promise((resolve) => setTimeout(() => resolve("still waiting"), 1200)),
		]);
		expect(outcome).toBe("still waiting");
	});

	it("#given a server busy for longer than the cap #when diagnostics are asked #then they stop at the cap with a freshness timeout, never a false clean", async () => {
		const { client, file } = await startClient(60_000, 300, 900);
		const started = Date.now();
		const result = await client.diagnostics(file);
		expect(result.transientError?.kind).toBe("freshness_timeout");
		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
		expect(Date.now() - started).toBeLessThan(5000);
	});

});
