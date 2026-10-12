/**
 * Test credentials the agent sets, captured from its own commands and the files it writes (fork roadmap 0.21,
 * entrega 2): `CREATE USER … PASSWORD`, `IDENTIFIED BY`, `POSTGRES_PASSWORD=`, connection URLs, `.env` and compose
 * files, `htpasswd -b`. A model that forgets the password it set tends to drop the database to start over; with the
 * password saved it can reuse it. References (`$VAR`, `${VAR}`, `${OMO_SECRET:x}`) and placeholders are not captured.
 */
export type CapturedCredential = {
  readonly name: string
  readonly kind: "postgres" | "mysql" | "mongo" | "redis" | "amqp" | "htpasswd" | "generic"
  readonly value: string
  readonly user?: string
  readonly host?: string
  readonly database?: string
  /** "command", or "<file>:<line>" for a file the agent wrote. */
  readonly origin: string
}

const PASSWORD_VARS = /^(?:POSTGRES_PASSWORD|PGPASSWORD|MYSQL_ROOT_PASSWORD|MYSQL_PASSWORD|MARIADB_ROOT_PASSWORD|MARIADB_PASSWORD|MONGO_INITDB_ROOT_PASSWORD|REDIS_PASSWORD|DB_PASSWORD|DATABASE_PASSWORD|[A-Z][A-Z0-9_]*_DB_PASS(?:WORD)?)$/

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === "" || trimmed.startsWith("$") || trimmed.includes("${") || /^<[^>]*>$/.test(trimmed) || /^\*+$/.test(trimmed) || trimmed.includes("OMO_SECRET")
}

function kindOfVar(name: string): CapturedCredential["kind"] {
  if (/^(?:POSTGRES|PG)/.test(name)) return "postgres"
  if (/^(?:MYSQL|MARIADB)/.test(name)) return "mysql"
  if (name.startsWith("MONGO")) return "mongo"
  if (name.startsWith("REDIS")) return "redis"
  return "generic"
}

function unquote(value: string): string {
  const trimmed = value.trim()
  return /^(["']).*\1$/s.test(trimmed) ? trimmed.slice(1, -1) : trimmed
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length
}

export function captureCredentials(text: string, origin: string): CapturedCredential[] {
  const found: CapturedCredential[] = []
  const where = (index: number) => (origin === "command" ? origin : `${origin}:${lineOf(text, index)}`)
  const add = (entry: Omit<CapturedCredential, "origin">, index: number) => {
    if (isPlaceholder(entry.value)) return
    if (found.some((existing) => existing.name === entry.name && existing.value === entry.value)) return
    found.push({ ...entry, origin: where(index) })
  }

  for (const match of text.matchAll(/\b(?:create|alter)\s+(?:user|role)\s+(?:if\s+not\s+exists\s+)?"?([\w-]+)"?[^;'"]*?\bpassword\s+'((?:''|[^'])*)'/gi)) {
    add({ name: `postgres-user-${match[1]}`, kind: "postgres", user: match[1], value: (match[2] ?? "").replace(/''/g, "'") }, match.index ?? 0)
  }
  for (const match of text.matchAll(/\b(?:create|alter)\s+user\s+(?:if\s+not\s+exists\s+)?['"`]?([\w.-]+)['"`]?(?:@['"`]?[^'"`\s]*['"`]?)?\s+identified\s+(?:with\s+\w+\s+)?by\s+(['"])(.*?)\2/gi)) {
    add({ name: `mysql-user-${match[1]}`, kind: "mysql", user: match[1], value: match[3] ?? "" }, match.index ?? 0)
  }

  const lines = text.split("\n")
  let offset = 0
  for (const line of lines) {
    const start = offset
    offset += line.length + 1
    if (/^\s*#/.test(line)) continue
    // VAR=value (shell, .env, compose list style) and VAR: value (compose map style)
    for (const match of line.matchAll(/(?:^|[\s"'-])([A-Z][A-Z0-9_]*)(?:=|:\s+)("[^"]*"|'[^']*'|[^\s"']+)/g)) {
      const name = match[1] ?? ""
      if (!PASSWORD_VARS.test(name)) continue
      const kind = kindOfVar(name)
      add({ name: kind === "generic" ? name : `${kind}-${name}`, kind, value: unquote(match[2] ?? "") }, start + (match.index ?? 0))
    }
  }

  for (const match of text.matchAll(/\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^:@/\s]*):([^@/\s]+)@([^:/\s?]+)(?::\d+)?(?:\/([\w.-]+))?/gi)) {
    const scheme = (match[1] ?? "").toLowerCase()
    const kind: CapturedCredential["kind"] = scheme.startsWith("postgres") ? "postgres" : scheme === "mariadb" || scheme === "mysql" ? "mysql" : scheme.startsWith("mongo") ? "mongo" : scheme.startsWith("redis") ? "redis" : "amqp"
    const user = match[2] || "default"
    const host = match[4] ?? ""
    const database = match[5]
    add({ name: `${kind}-url-${user}@${host}${database ? `/${database}` : ""}`, kind, user, host, ...(database ? { database } : {}), value: decodeURIComponent(match[3] ?? "") }, match.index ?? 0)
  }

  for (const match of text.matchAll(/\bhtpasswd\s+-\w*b\w*\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    add({ name: `htpasswd-${match[2]}`, kind: "htpasswd", user: match[2], value: unquote(match[3] ?? "") }, match.index ?? 0)
  }
  return found
}
