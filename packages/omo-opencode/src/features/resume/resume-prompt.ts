/** What a resumed agent is given: a focused card, not a replay of the old transcript (fork roadmap 0.8c). */
import { spawnSync } from "../../shared/bun-spawn-shim"
import { renderResumeMarkdown, restoreCheck, type ResumeCard } from "./store"

const MAX_DIFF = 6000

function diffOf(projectDir: string, card: ResumeCard): string {
  if (!card.wip) return ""
  const run = spawnSync(["git", "diff", card.wip.base, card.wip.ref], { cwd: projectDir, stdout: "pipe", stderr: "pipe" })
  const diff = run.stdout?.toString() ?? ""
  return diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… (diff truncated; see git diff ${card.wip.base.slice(0, 12)} ${card.wip.ref})` : diff
}

export function buildResumePrompt(projectDir: string, card: ResumeCard, hint?: string): string {
  const parts = [
    `[resume ${card.id}] Continue work that stopped earlier. Everything you need is below; the old transcript is not repeated.`,
    renderResumeMarkdown(card),
  ]
  if (card.wip) {
    const check = restoreCheck(projectDir, card.wip)
    parts.push(check.matches
      ? "The working tree still matches the saved work in progress."
      : `WARNING: the working tree no longer matches the saved work. Tell the user before changing files; it can be restored with: ${check.howToRestore}`)
    const diff = diffOf(projectDir, card)
    if (diff) parts.push(`Saved changes (from ${card.wip.ref}):\n\`\`\`diff\n${diff}\n\`\`\``)
  }
  if (hint?.trim()) parts.push(`The user's hint for this attempt: ${hint.trim()}`)
  parts.push([
    "Rules for this resume:",
    "- Do not repeat the attempts listed under \"Do not repeat\"; choose a different approach.",
    "- Start from the next action; check the plan file before marking anything done.",
    "- If the same problem comes back, stop and ask the user instead of retrying.",
  ].join("\n"))
  return parts.join("\n\n")
}
