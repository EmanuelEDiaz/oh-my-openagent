/** The whole file before and after a write/edit call, computed before it runs (fork roadmap 0.9c). */
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

export type ContentChange = { readonly path: string; readonly before: string; readonly after: string }

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

/**
 * Undefined when the result cannot be known up front (apply_patch, hashline edits, a missing oldString): those are
 * judged after they run, on the real file.
 */
export function contentChangeFromArgs(tool: string, args: Record<string, unknown>, directory: string): ContentChange | undefined {
  const name = tool.toLowerCase()
  const filePath = str(args["filePath"]) ?? str(args["file_path"]) ?? str(args["path"])
  if (!filePath) return undefined
  const path = isAbsolute(filePath) ? filePath : resolve(directory, filePath)
  const before = readText(path) ?? ""
  if (name === "write") return { path, before, after: str(args["content"]) ?? "" }
  if (name !== "edit" && name !== "multiedit") return undefined
  const edits = Array.isArray(args["edits"]) ? (args["edits"] as Record<string, unknown>[]) : [args]
  let after = before
  for (const edit of edits) {
    const oldString = str(edit?.["oldString"])
    const newString = str(edit?.["newString"])
    if (oldString === undefined || newString === undefined) return undefined
    if (oldString === "") {
      after = newString
      continue
    }
    if (!after.includes(oldString)) return undefined
    after = edit?.["replaceAll"] === true ? after.split(oldString).join(newString) : after.replace(oldString, () => newString)
  }
  return { path, before, after }
}
