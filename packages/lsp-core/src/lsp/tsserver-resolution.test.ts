import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveTypeScript6, withTsserverPath } from "./tsserver-resolution.js"

// Fork 0.25 (21-10-2026): TypeScript 7 ships no tsserver.js, so a project on 7, or a global install of `typescript` that
// is now 7, leaves typescript-language-server unable to start. The plugin finds a TypeScript 6 and passes its tsserver.
const roots: string[] = []
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function root(): string {
	const dir = mkdtempSync(join(tmpdir(), "omo-tsserver-"))
	roots.push(dir)
	return dir
}

function typescriptAt(nodeModules: string, version: string, withTsserver: boolean): string {
	const dir = join(nodeModules, "typescript")
	mkdirSync(join(dir, "lib"), { recursive: true })
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "typescript", version }))
	if (withTsserver) writeFileSync(join(dir, "lib", "tsserver.js"), "")
	return join(dir, "lib", "tsserver.js")
}

describe("resolveTypeScript6", () => {
	test("#given a project on TypeScript 6 #then its own tsserver is used", () => {
		const project = root()
		const expected = typescriptAt(join(project, "node_modules"), "6.0.3", true)
		mkdirSync(join(project, "src"))
		expect(resolveTypeScript6({ projectDir: join(project, "src"), globalModuleDirs: [] })).toEqual({ path: expected, version: "6.0.3", source: "project" })
	})

	test("#given a project on TypeScript 7 #then a global TypeScript 6 is used and the project version is reported", () => {
		const project = root()
		typescriptAt(join(project, "node_modules"), "7.0.2", false)
		const global = join(root(), "lib", "node_modules")
		const expected = typescriptAt(global, "6.0.3", true)
		expect(resolveTypeScript6({ projectDir: project, globalModuleDirs: [global] })).toEqual({ path: expected, version: "6.0.3", source: "global", projectVersion: "7.0.2" })
	})

	test("#given only a global TypeScript 7 #then nothing usable is found and the reason names version 7", () => {
		const global = join(root(), "lib", "node_modules")
		typescriptAt(global, "7.0.2", false)
		expect(resolveTypeScript6({ projectDir: root(), globalModuleDirs: [global] })).toEqual({ reason: "only TypeScript 7.0.2 found, which has no tsserver.js; install typescript@6" })
	})

	test("#given no TypeScript anywhere #then the reason says it is missing", () => {
		expect(resolveTypeScript6({ projectDir: root(), globalModuleDirs: [] })).toEqual({ reason: "no TypeScript installed; install typescript@6" })
	})

	test("#given the first global folder has 7 and a later one has 6 #then the 6 is found", () => {
		const first = join(root(), "node_modules")
		typescriptAt(first, "7.0.2", false)
		const second = join(root(), "node_modules")
		const expected = typescriptAt(second, "6.0.2", true)
		expect(resolveTypeScript6({ projectDir: root(), globalModuleDirs: [first, second] })).toMatchObject({ path: expected, source: "global" })
	})
})

describe("withTsserverPath", () => {
	test("#given a resolved TypeScript 6 and no path set #then the server gets it as tsserver.path", () => {
		expect(withTsserverPath({ preferences: { quoteStyle: "single" } }, { path: "/g/typescript/lib/tsserver.js", version: "6.0.3", source: "global" })).toEqual({
			preferences: { quoteStyle: "single" },
			tsserver: { path: "/g/typescript/lib/tsserver.js" },
		})
	})

	test("#given the user already set tsserver.path #then it is kept", () => {
		const own = { tsserver: { path: "/mine/tsserver.js", logVerbosity: "off" } }
		expect(withTsserverPath(own, { path: "/g/typescript/lib/tsserver.js", version: "6.0.3", source: "global" })).toBe(own)
	})

	test("#given no usable TypeScript #then the initialization is unchanged", () => {
		expect(withTsserverPath(undefined, { reason: "no TypeScript installed; install typescript@6" })).toBeUndefined()
	})
})
