/**
 * The user's one-time permission for a team lead without git-committer (Sisyphus, Hephaestus, Prometheus) to merge its
 * verified team/<name> branch into the user's branch (user decision 12-11-2026, fork roadmap 0.28). Only the user grants
 * it, by typing /omo-team-merge on|off: the setting is written to ~/.omo/omo.jsonc and applied at once.
 */
import { updateOmoConfig, type UpdateOmoConfigOptions } from "@oh-my-opencode/omo-config-core"

type UpdateConfig = (options: UpdateOmoConfigOptions) => unknown

let permission = false

export function seedTeamMergePermission(value: boolean | undefined): void {
  permission = value === true
}

export function leadMergesToBranch(): boolean {
  return permission
}

export function resetTeamMergePermissionForTesting(): void {
  permission = false
}

export function applyTeamMergeCommand(argument: string, update: UpdateConfig = updateOmoConfig): { ok: boolean; message: string } {
  const choice = argument.trim().toLowerCase()
  if (choice !== "on" && choice !== "off") {
    return { ok: false, message: "Usage: /omo-team-merge on | off" }
  }
  const value = choice === "on"
  try {
    update({ scope: "user", edits: [{ path: ["[opencode]", "team_mode", "lead_merges_to_branch"], value }] })
  } catch (error) {
    return { ok: false, message: `Could not save the permission: ${error instanceof Error ? error.message : String(error)}` }
  }
  permission = value
  return { ok: true, message: value ? "Team leads may now merge their verified team/ branch into your branch." : "Team leads no longer merge into your branch; they leave team/ ready for you or Atlas." }
}

/** Marker the /omo-team-merge template wraps its argument in; only a user message carries it (chat.message). */
export const TEAM_MERGE_MARKER = "omo-team-merge"
const MARKED = new RegExp(`<${TEAM_MERGE_MARKER}>\\s*([^<]*?)\\s*</${TEAM_MERGE_MARKER}>`)
const RAW = new RegExp(`^\\s*/${TEAM_MERGE_MARKER}(?:\\s+(\\S+))?\\s*$`)

/** The user's choice in their own /omo-team-merge message: "on", "off", "invalid", or undefined when it is not that command. */
export function teamMergeChoiceFromPrompt(text: string): "on" | "off" | "invalid" | undefined {
  const value = MARKED.exec(text)?.[1] ?? RAW.exec(text)?.[1]
  if (value === undefined) return MARKED.test(text) || RAW.test(text) ? "invalid" : undefined
  const choice = value.trim().toLowerCase()
  return choice === "on" || choice === "off" ? choice : "invalid"
}
