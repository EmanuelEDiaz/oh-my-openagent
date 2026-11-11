/**
 * Ideas mode, layer 1 (fork roadmap 0.23, approved 11-10-2026): while the user is brainstorming with Prometheus, an
 * idea reaches the plan only when the user says so. Decided by code from the user's own messages, never by a model:
 * the mode is on after `/omo-ideas` (or a message starting with "idea:") until `/omo-ideas off`, and a plan write is
 * allowed only when the latest user message is an explicit order such as "añádelo al plan" / "add it to the plan".
 * Reading the session's messages (not an in-memory flag) keeps the gate across OpenCode restarts.
 */
export const IDEAS_MODE_MARKER = "<omo-ideas-mode/>"

const USER_REQUEST = /<user-request>([\s\S]*?)<\/user-request>/

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

/** "on" / "off" when this message switches the mode, undefined otherwise. */
function modeSwitch(text: string): "on" | "off" | undefined {
  if (text.includes(IDEAS_MODE_MARKER)) return USER_REQUEST.exec(text)?.[1]?.trim().toLowerCase() === "off" ? "off" : "on"
  return /^\s*idea\s*:/i.test(text) ? "on" : undefined
}

/** User message texts, oldest first. */
export function ideasModeActive(userTexts: readonly string[]): boolean {
  let active = false
  for (const text of userTexts) {
    const next = modeSwitch(text)
    if (next) active = next === "on"
  }
  return active
}

const ORDER_VERB = String.raw`(?:anad|agreg|mete|meta|inclu|pasa|pasal|ponl|pon|suma|add|put|move|include)\w*`
const PLAN_PLACE = String.raw`\b(?:al|en el|dentro del|to the|in the|into the)\s+plan\b`
const ORDER = new RegExp(String.raw`\b${ORDER_VERB}\b[^.;?!]*${PLAN_PLACE}`)
const NEGATED = new RegExp(String.raw`\b(?:no|nunca|todavia no|aun no|don'?t|do not|not)\b[^.;?!]*\b${ORDER_VERB}\b`)

/** An explicit order to put an idea in the plan; questions, negations and plain agreement ("sí", "ok") are not. */
export function isExplicitPlanOrder(text: string): boolean {
  const normalized = normalize(text).trim()
  if (normalized.startsWith("¿") || normalized.endsWith("?")) return false
  return ORDER.test(normalized) && !NEGATED.test(normalized)
}

/** Undefined when Prometheus may write the plan now; otherwise the refusal it receives. */
export function planWriteRefusal(userTexts: readonly string[]): string | undefined {
  if (!ideasModeActive(userTexts)) return undefined
  const latest = userTexts.at(-1) ?? ""
  if (isExplicitPlanOrder(latest)) return undefined
  return "[ideas-mode] The user is brainstorming and has not asked to add anything to the plan in their latest message. "
    + "Keep the idea in .omo/ideas.md. If you think it is ready, ask the user (question tool) whether and which idea goes "
    + "into the plan; write the plan only after they say so explicitly (e.g. \"añádelo al plan\")."
}
