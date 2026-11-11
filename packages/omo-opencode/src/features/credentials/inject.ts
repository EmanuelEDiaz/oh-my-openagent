/**
 * `${OMO_SECRET:name}` in a shell command (fork roadmap 0.21, entrega 2): the plugin puts the saved value in through
 * an environment variable, so the value never appears in the command the model wrote, in the session history or in
 * the logs. The reference is rewritten for its quoting context: inside single quotes the quotes are closed around it,
 * so the value arrives intact whatever characters it holds.
 */
const PLACEHOLDER = /\$\{OMO_SECRET:([\w.@/-]+)\}/g

export function secretEnvName(name: string): string {
  return `OMO_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
}

export function injectSecrets(command: string, lookup: (name: string) => string | undefined): { command: string; env: Record<string, string>; missing: string[] } {
  if (!command.includes("${OMO_SECRET:")) return { command, env: {}, missing: [] }
  const env: Record<string, string> = {}
  const missing: string[] = []
  let out = ""
  let single = false
  let double = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string
    PLACEHOLDER.lastIndex = i
    const match = !single || ch === "$" ? PLACEHOLDER.exec(command) : null
    if (ch === "$" && match && match.index === i) {
      const name = match[1] as string
      const value = lookup(name)
      if (value === undefined) missing.push(name)
      else env[secretEnvName(name)] = value
      const reference = `\${${secretEnvName(name)}}`
      out += single ? `'"${reference}"'` : double ? reference : `"${reference}"`
      i += match[0].length - 1
      continue
    }
    if (ch === "\\" && !single) {
      out += ch + (command[i + 1] ?? "")
      i++
      continue
    }
    if (ch === "'" && !double) single = !single
    else if (ch === '"' && !single) double = !double
    out += ch
  }
  return { command: out, env, missing }
}

/** Replaces each saved value with `[secret:name]`, longest values first so one value inside another is not split. */
export function redactSecrets(text: string, secrets: readonly { name: string; value: string }[]): string {
  let result = text
  for (const secret of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    if (secret.value && result.includes(secret.value)) result = result.split(secret.value).join(`[secret:${secret.name}]`)
  }
  return result
}
