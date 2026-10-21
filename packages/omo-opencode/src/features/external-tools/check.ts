import { existsSync } from "node:fs"
import { join } from "node:path"

import { globalTypeScriptDirs, probeLanguageServer, resolveTypeScript6, withTsserverPath, type ProbeResult } from "@oh-my-opencode/lsp-core"

import { EXTERNAL_TOOLS, type ExternalTool, type ProjectLanguage } from "./inventory"

/** connects: found and working; fails: found but does not start or answer; missing: not installed. */
export type ToolStatus = "connects" | "fails" | "missing"

export type ToolReport = {
  readonly tool: ExternalTool
  readonly status: ToolStatus
  /** Resolved binary, version, or why it failed. */
  readonly detail: string
}

export type CheckDeps = {
  /** Path of a binary on PATH (or in the project), or null. */
  readonly which: (command: string, projectDir: string) => string | null
  /** Runs a command; resolves to its exit code and first output line, or undefined on timeout. */
  readonly run: (argv: readonly string[]) => Promise<{ exitCode: number; firstLine: string } | undefined>
  readonly probe: typeof probeLanguageServer
  readonly resolveTypeScript6: typeof resolveTypeScript6
  readonly globalTypeScriptDirs: typeof globalTypeScriptDirs
}

const LANGUAGE_MARKERS: Record<ProjectLanguage, readonly string[]> = {
  typescript: ["package.json", "tsconfig.json", "jsconfig.json"],
  python: ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile"],
  go: ["go.mod"],
  rust: ["Cargo.toml"],
}

/** Languages of the project, from the marker files at its root. */
export function projectLanguages(projectDir: string, exists: (path: string) => boolean = existsSync): Set<ProjectLanguage> {
  const found = new Set<ProjectLanguage>()
  for (const [language, markers] of Object.entries(LANGUAGE_MARKERS) as [ProjectLanguage, readonly string[]][]) {
    if (markers.some((marker) => exists(join(projectDir, marker)))) found.add(language)
  }
  return found
}

/** The tools this project needs: always-needed ones and those of its languages; optional ones only when asked. */
export function toolsFor(languages: ReadonlySet<ProjectLanguage>, includeOptional: boolean): ExternalTool[] {
  return EXTERNAL_TOOLS.filter((tool) => {
    if (tool.need.kind === "always") return true
    if (tool.need.kind === "optional") return includeOptional
    return languages.has(tool.need.language)
  })
}

async function checkLanguageServer(tool: ExternalTool, projectDir: string, deps: CheckDeps): Promise<ToolReport> {
  if (tool.check.kind !== "language-server") throw new Error(`${tool.id} is not a language server`)
  for (const server of tool.check.servers) {
    const binary = deps.which(server.command[0] ?? "", projectDir)
    if (binary === null) continue
    let initialization: Record<string, unknown> | undefined
    let typescriptNote = ""
    if (server.id === "typescript") {
      const typescript = deps.resolveTypeScript6({ projectDir, globalModuleDirs: deps.globalTypeScriptDirs(binary) })
      if (!("path" in typescript)) return { tool, status: "fails", detail: `${binary}: ${typescript.reason}` }
      initialization = withTsserverPath(undefined, typescript)
      typescriptNote = typescript.projectVersion ? ` (project has TypeScript ${typescript.projectVersion}; using ${typescript.version})` : ""
    }
    const result: ProbeResult = await deps.probe(projectDir, {
      id: server.id,
      command: [binary, ...server.command.slice(1)],
      extensions: [],
      priority: 0,
      ...(initialization ? { initialization } : {}),
    })
    if (result.status === "fails") return { tool, status: "fails", detail: `${binary}: ${result.detail.replace(/\s+/g, " ")}` }
    const version = result.typescriptVersion ? `, TypeScript ${result.typescriptVersion}` : ""
    return { tool, status: "connects", detail: `${binary} (${result.ms} ms${version})${typescriptNote}` }
  }
  return { tool, status: "missing", detail: `none of ${tool.check.servers.map((server) => server.command[0]).join(", ")} found` }
}

async function checkCommand(tool: ExternalTool, projectDir: string, deps: CheckDeps): Promise<ToolReport> {
  if (tool.check.kind !== "command") throw new Error(`${tool.id} is not a command`)
  const binary = deps.which(tool.check.command, projectDir)
  if (binary === null) return { tool, status: "missing", detail: `${tool.check.command} not found` }
  const result = await deps.run([binary, ...tool.check.args])
  if (result === undefined) return { tool, status: "fails", detail: `${binary} did not answer in time` }
  if (result.exitCode !== 0) return { tool, status: "fails", detail: `${binary} exited with ${result.exitCode}` }
  return { tool, status: "connects", detail: `${binary} (${result.firstLine})` }
}

export function checkTools(tools: readonly ExternalTool[], projectDir: string, deps: CheckDeps): Promise<ToolReport[]> {
  return Promise.all(tools.map((tool) => (tool.check.kind === "language-server" ? checkLanguageServer(tool, projectDir, deps) : checkCommand(tool, projectDir, deps))))
}

export async function checkExternalTools(projectDir: string, deps: CheckDeps, options: { includeOptional: boolean }): Promise<ToolReport[]> {
  return checkTools(toolsFor(projectLanguages(projectDir), options.includeOptional), projectDir, deps)
}
