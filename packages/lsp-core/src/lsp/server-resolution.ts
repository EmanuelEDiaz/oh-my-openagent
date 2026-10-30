import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { contextCwd } from "../request-context.js";
import { getDisabledServerIds, getMergedServers } from "./config-loader.js";
import { BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "./server-definitions.js";
import { isServerInstalled, resolveServerBinary } from "./server-installation.js";
import { globalTypeScriptDirs, resolveTypeScript6, withTsserverPath } from "./tsserver-resolution.js";
import type { ServerLookupResult } from "./types.js";

/**
 * Replaces the command name with the absolute binary path so the client spawns the exact
 * binary that was resolved -- in particular a repo-local one that is absent from PATH.
 */
function withResolvedCommand(command: string[], binaryPath: string): string[] {
	return [binaryPath, ...command.slice(1)];
}

/**
 * Servers that only make sense inside their own kind of project. `deno lsp` checks .ts files with Deno's module rules,
 * which mislead the agent in a Node or Bun project (fork incidents H15: chosen there because Deno was installed and
 * typescript-language-server was not).
 */
const PROJECT_MARKERS: Record<string, readonly string[]> = {
	deno: ["deno.json", "deno.jsonc"],
};

function hasMarkerUpwards(directory: string, markers: readonly string[]): boolean {
	for (let current = directory; ; current = dirname(current)) {
		if (markers.some((marker) => existsSync(join(current, marker)))) return true;
		if (dirname(current) === current) return false;
	}
}

function appliesToProject(serverId: string, workingDirectory: string): boolean {
	const markers = PROJECT_MARKERS[serverId];
	return markers === undefined || hasMarkerUpwards(workingDirectory, markers);
}

export function findServerForExtension(ext: string): ServerLookupResult {
	const servers = getMergedServers();
	const workingDirectory = contextCwd();

	for (const server of servers) {
		if (!server.extensions.includes(ext)) continue;
		if (!appliesToProject(server.id, workingDirectory)) continue;
		const binaryPath = resolveServerBinary(server.command, workingDirectory);
		if (binaryPath !== null) {
			// typescript-language-server cannot start on TypeScript 7 (no tsserver.js): give it a TypeScript 6 (fork 0.25).
			const initialization = server.id === "typescript"
				? withTsserverPath(server.initialization, resolveTypeScript6({ projectDir: workingDirectory, globalModuleDirs: globalTypeScriptDirs(binaryPath) }))
				: server.initialization;
			const resolvedServer = {
				id: server.id,
				command: withResolvedCommand(server.command, binaryPath),
				extensions: server.extensions,
				priority: server.priority,
			};
			if (server.env !== undefined) {
				return {
					status: "found",
					server: {
						...resolvedServer,
						env: server.env,
						...(initialization === undefined ? {} : { initialization }),
					},
				};
			}
			return {
				status: "found",
				server: {
					...resolvedServer,
					...(initialization === undefined ? {} : { initialization }),
				},
			};
		}
	}

	for (const server of servers) {
		if (server.extensions.includes(ext) && appliesToProject(server.id, workingDirectory)) {
			const installHint =
				LSP_INSTALL_HINTS[server.id] ?? `Install '${server.command[0]}' and ensure it's in your PATH`;
			return {
				status: "not_installed",
				server: {
					id: server.id,
					command: server.command,
					extensions: server.extensions,
				},
				installHint,
			};
		}
	}

	const availableServers = [...new Set(servers.map((s) => s.id))];
	return {
		status: "not_configured",
		extension: ext,
		availableServers,
	};
}

export interface ServerStatus {
	id: string;
	installed: boolean;
	extensions: string[];
	disabled: boolean;
	source: string;
	priority: number;
}

export function getAllServers(): ServerStatus[] {
	const servers = getMergedServers();
	const disabled = getDisabledServerIds();
	const workingDirectory = contextCwd();

	const result: ServerStatus[] = [];
	const seen = new Set<string>();

	for (const server of servers) {
		if (seen.has(server.id)) continue;
		result.push({
			id: server.id,
			installed: isServerInstalled(server.command, workingDirectory),
			extensions: server.extensions,
			disabled: false,
			source: server.source,
			priority: server.priority,
		});
		seen.add(server.id);
	}

	for (const id of disabled) {
		if (seen.has(id)) continue;
		const builtin = BUILTIN_SERVERS[id];
		result.push({
			id,
			installed: builtin ? isServerInstalled(builtin.command, workingDirectory) : false,
			extensions: builtin?.extensions ?? [],
			disabled: true,
			source: "disabled",
			priority: 0,
		});
	}

	return result;
}
