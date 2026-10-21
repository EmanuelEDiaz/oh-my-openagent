import { LspClientConnection } from "./connection.js";
import type { ResolvedServer } from "./types.js";

/**
 * Whether a language server really connects (fork 0.25): it is started and must answer the LSP `initialize` handshake
 * within the deadline, then it is shut down. A binary on PATH is not enough: typescript-language-server installs fine
 * and still cannot start on TypeScript 7. For TypeScript the version it loaded is read from its log, since it may fall
 * back silently to another install (typescript-language-server issue #1110).
 */
export type ProbeResult =
	| { readonly status: "connects"; readonly ms: number; readonly typescriptVersion?: string }
	| { readonly status: "fails"; readonly ms: number; readonly detail: string };

const TYPESCRIPT_VERSION = /Using Typescript version \(([^)]*)\) ([0-9][^ ]*)/;
/** After the handshake, how long to wait for the server's "Using Typescript version" log line. */
const VERSION_LOG_GRACE_MS = 1500;

class ProbeConnection extends LspClientConnection {
	readonly logLines: string[] = [];

	async open(): Promise<void> {
		await this.start();
		this.connection?.onNotification("window/logMessage", (params) => {
			const message = (params as { message?: unknown } | undefined)?.message;
			if (typeof message === "string") this.logLines.push(message);
		});
		await this.initialize();
	}

	stderrTail(): string {
		return this.stderrBuffer.join("").trim().slice(-400);
	}
}

export async function probeLanguageServer(root: string, server: ResolvedServer, timeoutMs = 20_000): Promise<ProbeResult> {
	const started = Date.now();
	const probe = new ProbeConnection(root, server, { initializeTimeoutMs: timeoutMs, requestTimeoutMs: timeoutMs });
	try {
		await probe.open();
		let version = typescriptVersion(probe.logLines);
		const deadline = Date.now() + VERSION_LOG_GRACE_MS;
		while (server.id === "typescript" && version === undefined && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			version = typescriptVersion(probe.logLines);
		}
		return { status: "connects", ms: Date.now() - started, ...(version === undefined ? {} : { typescriptVersion: version }) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const stderr = probe.stderrTail();
		return { status: "fails", ms: Date.now() - started, detail: stderr ? `${message} — ${stderr}` : message };
	} finally {
		await probe.stop().catch(() => undefined);
	}
}

function typescriptVersion(lines: readonly string[]): string | undefined {
	for (const line of lines) {
		const match = TYPESCRIPT_VERSION.exec(line);
		if (match) return match[2];
	}
	return undefined;
}
