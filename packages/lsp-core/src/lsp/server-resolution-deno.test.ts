import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runWithRequestContext } from "../request-context.js";
import { __resetServerBinaryResolutionCacheForTests } from "./server-installation.js";
import { findServerForExtension } from "./server-resolution.js";

// Fork incidents H15 (19-10-2026): with typescript-language-server missing and Deno installed, a Bun/Node project's
// .ts files were checked by `deno lsp`, whose module rules differ (node_modules, import extensions) and whose
// diagnostics would mislead the agent.
const roots: string[] = [];
let previousPath: string | undefined;

function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "lsp-deno-"));
	roots.push(root);
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(root, name, ".."), { recursive: true });
		writeFileSync(join(root, name), content);
	}
	const bin = join(root, "fake-bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "deno"), "#!/bin/sh\nexit 0\n");
	chmodSync(join(bin, "deno"), 0o755);
	process.env["PATH"] = bin;
	return root;
}

function lookup(cwd: string) {
	const context = {
		cwd,
		projectConfigPaths: [join(cwd, ".codex", "lsp-client.json")],
		userConfigPath: join(cwd, "home-config", "lsp-client.json"),
		installDecisionsPath: join(cwd, "home-config", "lsp-install-decisions.json"),
		capabilities: { installDecisionTool: true },
	} as const;
	return runWithRequestContext(context, () => findServerForExtension(".ts"));
}

beforeEach(() => {
	previousPath = process.env["PATH"];
	__resetServerBinaryResolutionCacheForTests();
});

afterEach(() => {
	if (previousPath === undefined) delete process.env["PATH"];
	else process.env["PATH"] = previousPath;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	__resetServerBinaryResolutionCacheForTests();
});

describe("deno lsp is only for Deno projects", () => {
	test("#given a Node/Bun project and only deno on PATH #when looking up a .ts file #then deno is not used and the TypeScript hint is given", () => {
		const root = project({ "package.json": "{}\n" });
		const result = lookup(root);
		expect(result.status).toBe("not_installed");
		expect(result.status === "not_installed" ? result.server.id : "").toBe("typescript");
	});

	test("#given a project with deno.json #when looking up a .ts file #then deno is used", () => {
		const root = project({ "deno.json": "{}\n" });
		const result = lookup(root);
		expect(result.status).toBe("found");
		expect(result.status === "found" ? result.server.id : "").toBe("deno");
	});

	test("#given a subfolder of a project with deno.jsonc #then deno is used there too", () => {
		const root = project({ "deno.jsonc": "{}\n", "src/app/main.ts": "export {}\n" });
		const result = lookup(join(root, "src", "app"));
		expect(result.status === "found" ? result.server.id : "").toBe("deno");
	});
});
