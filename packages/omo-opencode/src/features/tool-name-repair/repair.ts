/**
 * Broken tool names (fork roadmap 0.15 F). OpenCode's `experimental_repairToolCall` only lowercases the name; anything
 * else (a NUL byte, spaces, zero-width characters, case against a mixed-case tool) is turned into a call of the
 * `invalid` tool whose input keeps only `{ tool, error }`: the original arguments are gone, so the plugin cannot run the
 * intended tool itself. What it can do is rewrite the `invalid` result into a short, unambiguous retry instruction.
 */

/** OpenCode/AI SDK `NoSuchToolError` text: `Model tried to call unavailable tool 'x'. Available tools: a, b, c.` */
const UNAVAILABLE_TOOL = /unavailable tool '([\s\S]*?)'\.\s*Available tools:\s*([\s\S]*?)\.?\s*$/

/** Control, format (zero-width, BOM, bidi) and separator characters, plus any whitespace. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Z}\s]/gu
const WRAPPING_QUOTES = /^['"`]+|['"`]+$/g

export type UnavailableToolCall = { readonly name: string; readonly available: readonly string[] }

export function parseUnavailableToolError(error: string): UnavailableToolCall | undefined {
  const match = UNAVAILABLE_TOOL.exec(error)
  if (!match) return undefined
  const available = match[2]!.split(",").map((tool) => tool.trim()).filter((tool) => tool.length > 0)
  return { name: match[1]!, available }
}

export function cleanToolName(name: string): string {
  return name.replace(INVISIBLE, "").replace(WRAPPING_QUOTES, "").toLowerCase()
}

/** The one available tool the broken name stands for; undefined when it matches none or several (left as is). */
export function resolveToolName(name: string, available: readonly string[]): string | undefined {
  if (available.includes(name)) return undefined
  const cleaned = cleanToolName(name)
  if (cleaned.length === 0) return undefined
  const matches = available.filter((tool) => tool !== "invalid" && tool.toLowerCase() === cleaned)
  return matches.length === 1 ? matches[0] : undefined
}

/** The name as the model should see it: invisible characters escaped (`bash\u0000`). */
export function visibleName(name: string): string {
  return JSON.stringify(name).slice(1, -1)
}

export const repairHint = (badName: string, toolName: string): string =>
  `[tool-name-repair] You called the tool '${visibleName(badName)}', which does not exist: the name has stray characters. ` +
  `The tool is named '${toolName}'. Call '${toolName}' again now with the same arguments, then continue the task.`

export const continuationText = (badName: string, toolName: string): string =>
  `[tool-name-repair] Your last tool call used the name '${visibleName(badName)}' and did not run. The tool is named ` +
  `'${toolName}'. Call '${toolName}' with the arguments you intended and continue the task.`
