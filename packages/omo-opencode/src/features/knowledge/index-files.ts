import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { promisify } from "node:util"

import type { KnowledgeStore } from "./store"
import type { KnowledgeDocument, KnowledgeKind } from "./types"

const execFileAsync = promisify(execFile)

export const DEFAULT_DIRECTORIES = ["plans", ".omo/plans", ".omo/drafts", ".omo/notepads", "docs/adr", "docs/decisions"] as const
export const DEFAULT_FILES = ["AGENTS.md", "CLAUDE.md", "CHANGELOG.md"] as const
const MAX_FILE_BYTES = 1_000_000
const MAX_FILES = 2000
const MAX_CHUNK_CHARS = 3000
const FILE_SOURCE_PREFIX = "file:"

export type MarkdownChunk = { readonly line: number; readonly title: string; readonly body: string }

export function kindForPath(path: string): KnowledgeKind {
  const normalized = path.split(sep).join("/")
  const name = normalized.slice(normalized.lastIndexOf("/") + 1)
  if (normalized.startsWith("docs/decisions/")) return "decision"
  if (normalized.startsWith("docs/adr/")) return "adr"
  if (normalized.startsWith(".omo/notepads/")) return "notepad"
  if (normalized.startsWith("plans/") || /^\.omo\/(plans|drafts)\//.test(normalized)) return "plan"
  if (name === "AGENTS.md" || name === "CLAUDE.md") return "agents_md"
  if (name === "CHANGELOG.md") return "changelog"
  return "doc"
}

function splitLongSection(title: string, startLine: number, lines: readonly string[]): MarkdownChunk[] {
  const text = lines.join("\n")
  if (text.length <= MAX_CHUNK_CHARS) return text.trim().length === 0 ? [] : [{ line: startLine, title, body: text }]
  const chunks: MarkdownChunk[] = []
  let current: string[] = []
  let currentStart = startLine
  lines.forEach((line, index) => {
    if (current.length === 0) currentStart = startLine + index
    current.push(line)
    const atParagraphEnd = line.trim().length === 0 || index === lines.length - 1
    if (atParagraphEnd && current.join("\n").length >= MAX_CHUNK_CHARS / 2) {
      if (current.join("\n").trim().length > 0) chunks.push({ line: currentStart, title, body: current.join("\n") })
      current = []
    }
  })
  if (current.join("\n").trim().length > 0) chunks.push({ line: currentStart, title, body: current.join("\n") })
  return chunks
}

/** Splits markdown by headings (ignoring code fences); each chunk keeps its 1-based start line. */
export function chunkMarkdown(content: string, fileName: string): MarkdownChunk[] {
  const lines = content.split("\n")
  const headingPath: string[] = []
  const chunks: MarkdownChunk[] = []
  let sectionStart = 1
  let sectionTitle = fileName
  let sectionLines: string[] = []
  let inFence = false

  const flush = (): void => {
    chunks.push(...splitLongSection(sectionTitle, sectionStart, sectionLines))
  }

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const heading = inFence ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading?.[1] && heading[2] !== undefined) {
      flush()
      const level = heading[1].length
      headingPath.splice(level - 1)
      headingPath[level - 1] = heading[2]
      sectionTitle = headingPath.filter((part) => part !== undefined).join(" > ")
      sectionStart = index + 1
      sectionLines = [line]
      return
    }
    sectionLines.push(line)
  })
  flush()
  return chunks
}

function walkMarkdown(root: string, directory: string, found: string[]): void {
  if (found.length >= MAX_FILES || !existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walkMarkdown(root, path, found)
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(relative(root, path))
    if (found.length >= MAX_FILES) return
  }
}

async function trackedAgentFiles(projectDir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectDir, "ls-files", "-z", "--", ":(glob)**/AGENTS.md", ":(glob)**/CLAUDE.md"], { maxBuffer: 8_000_000 })
    return stdout.split("\0").filter((path) => path.length > 0)
  } catch {
    return []
  }
}

export async function discoverProjectFiles(projectDir: string, extraPaths: readonly string[] = []): Promise<string[]> {
  const found: string[] = []
  for (const directory of [...DEFAULT_DIRECTORIES, ...extraPaths]) {
    const absolute = join(projectDir, directory)
    if (existsSync(absolute) && statSync(absolute).isFile()) found.push(relative(projectDir, absolute))
    else walkMarkdown(projectDir, absolute, found)
  }
  for (const file of DEFAULT_FILES) if (existsSync(join(projectDir, file))) found.push(file)
  found.push(...await trackedAgentFiles(projectDir))
  return [...new Set(found.map((path) => path.split(sep).join("/")))].slice(0, MAX_FILES)
}

/** Reindexes only files whose content hash changed and drops files that no longer exist. */
export async function indexProjectFiles(store: KnowledgeStore, projectDir: string, extraPaths: readonly string[] = []): Promise<number> {
  const files = await discoverProjectFiles(projectDir, extraPaths)
  const seen = new Set<string>()
  let indexed = 0
  for (const path of files) {
    const absolute = join(projectDir, path)
    let content: string
    try {
      if (statSync(absolute).size > MAX_FILE_BYTES) continue
      content = readFileSync(absolute, "utf-8")
    } catch {
      continue
    }
    const source = `${FILE_SOURCE_PREFIX}${path}`
    seen.add(source)
    const hash = createHash("sha1").update(content).digest("hex")
    if (store.sourceHash(source) === hash) continue
    const kind = kindForPath(path)
    const updatedAt = statSync(absolute).mtimeMs
    const documents: KnowledgeDocument[] = chunkMarkdown(content, path).map((chunk) => ({
      kind,
      source,
      locator: `${path}:${chunk.line}`,
      title: chunk.title,
      body: chunk.body,
      updatedAt,
    }))
    store.replaceSource(source, hash, documents)
    indexed++
  }
  for (const source of store.listSources(FILE_SOURCE_PREFIX)) {
    if (!seen.has(source)) store.removeSource(source)
  }
  return indexed
}
