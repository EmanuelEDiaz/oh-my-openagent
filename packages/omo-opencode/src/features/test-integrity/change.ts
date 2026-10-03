/**
 * What a file-writing tool call would change, per file, before it runs (fork roadmap 0.9a). Lines present on both sides
 * cancel out, so moving code around is not mistaken for adding or removing it.
 */
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

export type FileChange = {
  /** Absolute path. */
  readonly path: string
  readonly kind: "add" | "update" | "delete"
  readonly added: readonly string[]
  readonly removed: readonly string[]
  /** False when the change cannot be computed from the arguments (hashline edits); checked after it runs instead. */
  readonly exact: boolean
}

function lines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** Multiset line difference: `added` = lines in `after` not matched in `before`, and the reverse. */
export function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const counts = new Map<string, number>()
  for (const line of lines(before)) counts.set(line, (counts.get(line) ?? 0) + 1)
  const added: string[] = []
  for (const line of lines(after)) {
    const left = counts.get(line) ?? 0
    if (left > 0) counts.set(line, left - 1)
    else added.push(line)
  }
  const removed: string[] = []
  for (const [line, left] of counts) for (let i = 0; i < left; i++) removed.push(line)
  return { added: added.filter((line) => line.trim()), removed: removed.filter((line) => line.trim()) }
}

function readText(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined
  } catch {
    return undefined
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function absolute(directory: string, path: string): string {
  return isAbsolute(path) ? path : resolve(directory, path)
}

function parsePatch(directory: string, patch: string): FileChange[] {
  const changes: FileChange[] = []
  let current: { path: string; kind: FileChange["kind"]; added: string[]; removed: string[] } | undefined
  const flush = () => {
    if (!current) return
    if (current.kind === "delete") {
      const before = readText(current.path) ?? ""
      changes.push({ path: current.path, kind: "delete", added: [], removed: lines(before).filter((line) => line.trim()), exact: true })
    } else {
      const diff = lineDiff(current.removed.join("\n"), current.added.join("\n"))
      changes.push({ path: current.path, kind: current.kind, added: diff.added, removed: diff.removed, exact: true })
    }
    current = undefined
  }
  for (const line of lines(patch)) {
    const header = /^\*\*\* (Add File|Update File|Delete File): (.+)$/.exec(line)
    if (header?.[1] && header[2]) {
      flush()
      const kind = header[1] === "Add File" ? "add" : header[1] === "Delete File" ? "delete" : "update"
      current = { path: absolute(directory, header[2].trim()), kind, added: [], removed: [] }
      continue
    }
    if (!current || line.startsWith("***") || line.startsWith("@@")) continue
    if (line.startsWith("+")) current.added.push(line.slice(1))
    else if (line.startsWith("-")) current.removed.push(line.slice(1))
  }
  flush()
  return changes
}

/** Changes a write-capable tool call would make, or an empty list for other tools. */
export function changesFromArgs(tool: string, args: Record<string, unknown>, directory: string): FileChange[] {
  const name = tool.toLowerCase()
  const filePath = str(args["filePath"]) ?? str(args["file_path"]) ?? str(args["path"])
  if (name === "write" && filePath) {
    const path = absolute(directory, filePath)
    const before = readText(path)
    const diff = lineDiff(before ?? "", str(args["content"]) ?? "")
    return [{ path, kind: before === undefined ? "add" : "update", ...diff, exact: true }]
  }
  if (name === "apply_patch") {
    const patch = str(args["patchText"]) ?? str(args["patch"]) ?? str(args["input"])
    return patch ? parsePatch(directory, patch) : []
  }
  if ((name === "edit" || name === "multiedit" || name === "hashline_edit") && filePath) {
    const path = absolute(directory, filePath)
    const edits = Array.isArray(args["edits"]) ? (args["edits"] as Record<string, unknown>[]) : [args]
    if (args["delete"] === true) {
      return [{ path, kind: "delete", added: [], removed: lines(readText(path) ?? "").filter((line) => line.trim()), exact: true }]
    }
    const pairs = edits.map((edit) => ({ old: str(edit?.["oldString"]), new: str(edit?.["newString"]) }))
    if (pairs.every((pair) => pair.old !== undefined && pair.new !== undefined)) {
      const diff = lineDiff(pairs.map((pair) => pair.old).join("\n"), pairs.map((pair) => pair.new).join("\n"))
      return [{ path, kind: readText(path) === undefined ? "add" : "update", ...diff, exact: true }]
    }
    // Hashline edits name lines by anchor; only the inserted text is known up front.
    const inserted = edits.flatMap((edit) => {
      const value = edit?.["lines"]
      return Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : lines(str(value) ?? "")
    })
    return [{ path, kind: "update", added: inserted.filter((line) => line.trim()), removed: [], exact: false }]
  }
  return []
}
