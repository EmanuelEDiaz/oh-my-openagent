const PATCH_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/

/**
 * Every file a write-capable tool call would touch: direct path arguments, a hashline `rename` target, multiedit
 * entries and every file named inside an apply_patch body (including deletes and move targets). An empty result means
 * the target cannot be determined, which the caller treats as blocked (fail closed).
 */
export function extractTargetPaths(args: Record<string, unknown>): string[] {
  const paths: string[] = []
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) paths.push(value.trim())
  }
  for (const key of ["filePath", "file_path", "path", "file", "rename", "newPath", "new_path"]) push(args[key])
  if (Array.isArray(args["edits"])) {
    for (const edit of args["edits"]) {
      if (typeof edit === "object" && edit !== null) push((edit as Record<string, unknown>)["filePath"])
    }
  }
  for (const key of ["patchText", "patch", "input"]) {
    const body = args[key]
    if (typeof body !== "string") continue
    for (const line of body.split(/\r?\n/)) push(PATCH_HEADER.exec(line)?.[1])
  }
  return paths
}
