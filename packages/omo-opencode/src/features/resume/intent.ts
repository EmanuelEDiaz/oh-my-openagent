/**
 * Resuming in plain words (fork roadmap 0.8c): "reanuda", "sigue con lo de antes" or "continue where you left off" must
 * work without a command. Detection is deliberately narrow: only phrases about the earlier/stopped work, so "continúa
 * con el siguiente test" or "resume this text" are not hijacked.
 */
const RESUME_PATTERNS: readonly RegExp[] = [
  /^\s*\/?omo-resume\b/i,
  /^\s*(reanuda|retoma|resume|continue)\s*[.!]*\s*$/i,
  /\b(reanuda|retoma)\b.*\b(lo que|la tarea|el trabajo|donde|antes|estabas)\b/i,
  /\b(contin[uú]a|sigue|vuelve)\b.*\b(lo de antes|donde lo dejaste|donde lo dejamos|con lo que (hac[ií]as|estabas)|a lo que estabas)\b/i,
  /\b(continue|resume|pick up)\b.*\b(where (you|we) left off|what you were doing|the previous task|the paused work)\b/i,
]

export function isResumeIntent(text: string): boolean {
  return RESUME_PATTERNS.some((pattern) => pattern.test(text))
}

export const PAUSED_WORK_TAG = "<omo-paused-work>"

export function pausedWorkGuidance(paused: readonly { id: string; reason: string; nextAction: string }[]): string | undefined {
  if (paused.length === 0) return undefined
  return [
    PAUSED_WORK_TAG,
    "There is paused work in this project:",
    ...paused.slice(0, 3).map((card) => `- ${card.id}: stopped because ${card.reason}; next: ${card.nextAction}`),
    "If the user asks to resume or continue earlier work (in any words, e.g. \"reanuda\", \"sigue con lo de antes\"), call resume_task({ id }) first and follow it.",
    "</omo-paused-work>",
  ].join("\n")
}

/** Appended to the user's message when they ask to resume and there is paused work. */
export function resumeReminder(text: string, paused: readonly { id: string; reason: string }[]): string | undefined {
  if (paused.length === 0 || !isResumeIntent(text)) return undefined
  const [newest, ...others] = paused
  const rest = others.length > 0 ? ` Other paused work: ${others.map((card) => card.id).join(", ")}.` : ""
  return `[resume] The user asks to resume earlier work. Call resume_task({ id: "${newest!.id}" }) first (stopped because ${newest!.reason}) and continue as it says.${rest}`
}
