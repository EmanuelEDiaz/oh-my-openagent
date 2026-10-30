import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, sep } from "node:path";

/**
 * A TypeScript that typescript-language-server can start with (fork 0.25). TypeScript 7 ships no `lib/tsserver.js`, so a
 * project on 7, or a global `typescript` that is now 7, leaves the server unable to start: the plugin finds a 6 and
 * passes its tsserver as `initializationOptions.tsserver.path`.
 */
export type TypeScript6 =
	| { readonly path: string; readonly version: string; readonly source: "project" | "global"; readonly projectVersion?: string }
	| { readonly reason: string };

type Found = { readonly tsserver: string; readonly version: string; readonly usable: boolean };

function readTypeScript(packageDir: string): Found | undefined {
	try {
		const version = (JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { version?: unknown }).version;
		if (typeof version !== "string") return undefined;
		const tsserver = join(packageDir, "lib", "tsserver.js");
		const major = Number.parseInt(version, 10);
		return { tsserver, version, usable: major < 7 && existsSync(tsserver) };
	} catch {
		return undefined;
	}
}

/** The project's own TypeScript: the nearest `node_modules/typescript` from `projectDir` upwards. */
function projectTypeScript(projectDir: string): Found | undefined {
	let dir = projectDir;
	const { root } = parse(dir);
	for (;;) {
		const found = readTypeScript(join(dir, "node_modules", "typescript"));
		if (found) return found;
		if (dir === root) return undefined;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function resolveTypeScript6(input: { readonly projectDir: string; readonly globalModuleDirs: readonly string[] }): TypeScript6 {
	const project = projectTypeScript(input.projectDir);
	if (project?.usable) return { path: project.tsserver, version: project.version, source: "project" };
	const seenSeven: string[] = project ? [project.version] : [];
	for (const modules of input.globalModuleDirs) {
		const global = readTypeScript(join(modules, "typescript"));
		if (!global) continue;
		if (global.usable) {
			return { path: global.tsserver, version: global.version, source: "global", ...(project ? { projectVersion: project.version } : {}) };
		}
		seenSeven.push(global.version);
	}
	if (seenSeven.length === 0) return { reason: "no TypeScript installed; install typescript@6" };
	return { reason: `only TypeScript ${seenSeven[0]} found, which has no tsserver.js; install typescript@6` };
}

/**
 * Where a global TypeScript can live: next to the resolved typescript-language-server (an npm global install keeps both
 * in one `node_modules`), then every Node that mise installed (each keeps its own globals).
 */
export function globalTypeScriptDirs(serverBinary: string | null, home: string = process.env["HOME"]?.trim() || homedir()): string[] {
	const dirs: string[] = [];
	if (serverBinary) {
		try {
			const real = realpathSync(serverBinary);
			const marker = `${sep}node_modules${sep}`;
			const at = real.lastIndexOf(marker);
			if (at !== -1) dirs.push(real.slice(0, at + marker.length - 1));
		} catch {
			// Not resolvable: the other places still count.
		}
	}
	const miseNodes = join(home, ".local", "share", "mise", "installs", "node");
	try {
		for (const version of readdirSync(miseNodes).sort().reverse()) dirs.push(join(miseNodes, version, "lib", "node_modules"));
	} catch {
		// No mise.
	}
	return [...new Set(dirs)];
}

/** The server's initialization with the resolved tsserver, unless the user already chose one. */
export function withTsserverPath(
	initialization: Record<string, unknown> | undefined,
	typescript: TypeScript6,
): Record<string, unknown> | undefined {
	if (!("path" in typescript)) return initialization;
	const current = initialization?.["tsserver"];
	const tsserver = typeof current === "object" && current !== null ? (current as Record<string, unknown>) : {};
	if (typeof tsserver["path"] === "string" && tsserver["path"] !== "") return initialization;
	return { ...initialization, tsserver: { ...tsserver, path: typescript.path } };
}
