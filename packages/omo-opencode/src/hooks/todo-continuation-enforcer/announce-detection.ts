/**
 * "Announces its next step and stops" (fork incident H58): on the real inventory task Sisyphus ended a turn with
 * "Voy a verificarlo… leyendo entidades" after a compaction, used no tool, had no todos, and nothing made it continue.
 * Decided by code from the last message: no tool in that turn, its closing sentences announce an action, and it is
 * neither a question to the user nor a report that the work is finished.
 */
type MessagePart = { type?: string; text?: string }
type MessageLike = { info?: { role?: string }; parts?: MessagePart[] }

const ANNOUNCE = [
  /\b(voy a|vamos a|ahora (voy|paso|reviso|corrijo|compruebo|miro|leo|arreglo|ejecuto|busco)|a continuaci[oó]n|primero (voy|reviso|miro|compruebo)|procedo a|paso a)\b/,
  /\b(i'?ll|i will|i'?m going to|let me|next,? i|now i (will|'?ll)|i am going to)\b/,
]
const DONE = /\b(listo|hecho|terminad[oa]|completad[oa]|ya (est[aá]|funciona)|todo funciona|done|finished|completed|all tests pass)\b/

function lastSentences(text: string, count = 2): string {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/).filter(Boolean)
  return sentences.slice(-count).join(" ")
}

export function announcedNextStep(messages: readonly MessageLike[]): boolean {
  const last = messages.at(-1)
  if (last?.info?.role !== "assistant") return false
  const parts = last.parts ?? []
  if (parts.some((part) => part.type === "tool")) return false
  const text = parts.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim()
  if (!text) return false
  const ending = lastSentences(text).toLowerCase()
  if (/[?¿]/.test(ending)) return false
  if (DONE.test(text.toLowerCase())) return false
  return ANNOUNCE.some((pattern) => pattern.test(ending))
}
