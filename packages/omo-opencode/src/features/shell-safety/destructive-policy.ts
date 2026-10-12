/**
 * Destructive commands (fork roadmap 0.21, entrega 1): what a line would destroy, wherever it hides — SQL in `psql -c`,
 * heredocs, `docker exec`, `.sql` files and scripts the agent runs; ORM resets; Docker volumes; `rm` of data; database
 * servers uninstalled; destructive git. A finding on a clearly-test target (`*_test`, `:memory:`, `/tmp`, a test
 * environment) is marked `test` and allowed by the guard; anything else needs the user's approval for that exact
 * command. Text that only mentions SQL (`grep 'DROP TABLE'`, a commit message) is not a finding: only the arguments
 * a database client really executes are read.
 */
import { isAbsolute, resolve } from "node:path"

import { parseShell, type ShellCommand } from "./parse"

export type DestructiveFinding = {
  /** What would be destroyed, e.g. "DROP DATABASE via psql". */
  readonly what: string
  /** True when the target is clearly a test one (allowed without asking). */
  readonly test: boolean
}

export type DestructiveOptions = {
  readonly directory: string
  /** The text of a file the command runs (`psql -f x.sql`, `python x.py`), when it exists. */
  readonly readFile: (absolutePath: string) => string | undefined
}

const TEST_NAME = /(?:^|[_\-./])tests?(?:$|[_\-.])|:memory:|^\/tmp\/|^\/var\/tmp\//i
const TEST_ENV_VARS = ["RAILS_ENV", "RACK_ENV", "NODE_ENV", "APP_ENV", "DJANGO_ENV", "MIX_ENV", "FLASK_ENV", "ENVIRONMENT"]
const DATA_PATH = /(?:^|\/)(?:data|db|database|pgdata|mysql|postgres(?:ql)?|mongo(?:db)?|redis|volumes?|storage|backups?)(?:\/|$)|\.(?:sqlite3?|db)$/i
const CATASTROPHIC_PATH = /^(?:\/|~\/?|\$HOME\/?|\*|\.\/?\*?|\.\.\/?)$/
const DB_PACKAGE = /postgres|mysql|mariadb|mongo|redis|sqlite|cassandra|elasticsearch|clickhouse/i

function baseName(word: string | undefined): string {
  return (word ?? "").replace(/^.*[/\\]/, "").replace(/\.exe$/i, "").toLowerCase()
}

function isTestEnv(command: ShellCommand): boolean {
  if (TEST_ENV_VARS.some((name) => /^test(?:ing)?$/i.test(command.env[name] ?? ""))) return true
  return command.argv.some((arg, index) => /^--env=test(?:ing)?$/i.test(arg) || ((arg === "--env" || arg === "-e") && /^test(?:ing)?$/i.test(command.argv[index + 1] ?? "")))
}

function stripSql(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:''|[^'])*'/g, "''")
}

const SQL_RULES: ReadonlyArray<{ readonly test: (statement: string) => boolean; readonly label: (statement: string) => string }> = [
  { test: (s) => /^drop\s+(?:database|schema|table|user|role|owned|view|materialized\s+view|index|extension)\b/.test(s), label: (s) => s.match(/^drop\s+(?:materialized\s+view|\w+)/)?.[0]?.toUpperCase() ?? "DROP" },
  { test: (s) => /^truncate\b/.test(s), label: () => "TRUNCATE" },
  { test: (s) => /^delete\s+from\b/.test(s) && !/\bwhere\b/.test(s), label: () => "DELETE without WHERE" },
  { test: (s) => /^update\b[\s\S]*\bset\b/.test(s) && !/\bwhere\b/.test(s), label: () => "UPDATE without WHERE" },
  { test: (s) => /^alter\s+table\b[\s\S]*\bdrop\b/.test(s), label: () => "ALTER TABLE … DROP" },
  { test: (s) => /^flush(?:all|db)\b/.test(s), label: (s) => s.split(/\s/)[0]?.toUpperCase() ?? "FLUSH" },
]

/** The object a destructive statement names: `DROP DATABASE IF EXISTS x` → x, `TRUNCATE TABLE x` → x. */
function sqlTarget(statement: string): string | undefined {
  return /^(?:drop\s+(?:materialized\s+view|\w+)|truncate(?:\s+table)?|delete\s+from|update|alter\s+table)\s+(?:if\s+exists\s+)?([\w."`\[\]]+)/.exec(statement)?.[1]?.replace(/["`\[\]]/g, "")
}

/** Destructive statements in SQL that a client executes, with the object each one names. */
function sqlOperations(sql: string): { label: string; target?: string }[] {
  const found: { label: string; target?: string }[] = []
  for (const statement of stripSql(sql).split(";")) {
    const normalized = statement.trim().replace(/\s+/g, " ").toLowerCase()
    for (const rule of SQL_RULES) if (rule.test(normalized)) found.push({ label: rule.label(normalized), target: sqlTarget(normalized) })
  }
  return found
}

/** Destructive operations mentioned anywhere in program code (scripts and `-c`/`-e` code). */
function codeOperations(code: string): string[] {
  const found: string[] = []
  for (const match of code.matchAll(/\bdrop\s+(database|schema|table|user|role)\b/gi)) found.push(`DROP ${match[1]?.toUpperCase()}`)
  if (/\btruncate\s+(?:table\s+)?[\w."`]+/i.test(code)) found.push("TRUNCATE")
  if (/\bdropDatabase\s*\(|\bFLUSHALL\b|\bflushall\s*\(/i.test(code)) found.push("drop a whole database")
  return found
}

/** Values of options (`-c x`, `--command=x`) and the positional arguments. */
function readArgs(argv: readonly string[], valued: ReadonlySet<string>): { options: Map<string, string[]>; positionals: string[] } {
  const options = new Map<string, string[]>()
  const positionals: string[] = []
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index] as string
    const eq = arg.indexOf("=")
    if (arg.startsWith("--") && eq !== -1) {
      const key = arg.slice(0, eq)
      options.set(key, [...(options.get(key) ?? []), arg.slice(eq + 1)])
    } else if (valued.has(arg)) {
      options.set(arg, [...(options.get(arg) ?? []), argv[index + 1] ?? ""])
      index++
    } else if (/^-[a-zA-Z]$/.test(arg.slice(0, 2)) && arg.length > 2 && valued.has(arg.slice(0, 2))) {
      options.set(arg.slice(0, 2), [...(options.get(arg.slice(0, 2)) ?? []), arg.slice(2)])
    } else if (!arg.startsWith("-")) positionals.push(arg)
  }
  return { options, positionals }
}

type Context = { readonly options: DestructiveOptions; readonly findings: DestructiveFinding[] }

function readProjectFile(ctx: Context, path: string): string | undefined {
  return ctx.options.readFile(isAbsolute(path) ? path : resolve(ctx.options.directory, path))
}

function add(ctx: Context, what: string, test: boolean): void {
  ctx.findings.push({ what, test })
}

const CLIENTS: Readonly<Record<string, { sql: readonly string[]; files: readonly string[]; db: readonly string[]; valued: readonly string[]; sqlPositional?: number }>> = {
  psql: { sql: ["-c", "--command"], files: ["-f", "--file"], db: ["-d", "--dbname"], valued: ["-U", "--username", "-h", "--host", "-p", "--port", "-v", "--set", "-o", "--output"] },
  mysql: { sql: ["-e", "--execute"], files: [], db: ["-D", "--database"], valued: ["-u", "--user", "-h", "--host", "-P", "--port", "-p"] },
  mariadb: { sql: ["-e", "--execute"], files: [], db: ["-D", "--database"], valued: ["-u", "--user", "-h", "--host", "-P", "--port"] },
  sqlite3: { sql: [], files: [], db: [], valued: ["-cmd", "-separator"], sqlPositional: 1 },
  sqlcmd: { sql: ["-Q", "-q"], files: ["-i"], db: ["-d"], valued: ["-S", "-U", "-P"] },
  "clickhouse-client": { sql: ["-q", "--query"], files: [], db: ["-d", "--database"], valued: ["-h", "--host", "-u", "--user"] },
  duckdb: { sql: ["-c"], files: [], db: [], valued: [], sqlPositional: 1 },
}

function judgeClient(command: ShellCommand, name: string, ctx: Context): void {
  const spec = CLIENTS[name]
  if (!spec) return
  const valued = new Set([...spec.sql, ...spec.files, ...spec.db, ...spec.valued])
  const { options, positionals } = readArgs(command.argv, valued)
  const sql: string[] = [...spec.sql.flatMap((key) => options.get(key) ?? []), ...(command.stdin !== undefined ? [command.stdin] : [])]
  for (const file of spec.files.flatMap((key) => options.get(key) ?? [])) sql.push(readProjectFile(ctx, file) ?? "")
  if (spec.sqlPositional !== undefined && positionals[spec.sqlPositional]) sql.push(positionals[spec.sqlPositional] as string)
  const database = spec.db.flatMap((key) => options.get(key) ?? [])[0] ?? positionals[0] ?? ""
  // Test when the database connected to, or the object the statement names, is clearly a test one.
  for (const operation of sql.flatMap(sqlOperations)) {
    // A test-looking table can live in a real database: only a dropped database or schema is judged by its own name.
    const namedTest = /^DROP (?:DATABASE|SCHEMA)$/.test(operation.label) && operation.target !== undefined && TEST_NAME.test(operation.target)
    const test = TEST_NAME.test(database) || namedTest || isTestEnv(command)
    add(ctx, `${operation.label} via ${name}${operation.target ? ` ${operation.target}` : database ? ` (${database})` : ""}`, test)
  }
}

/** `npx prisma …`, `pnpm exec x`, `bun x y`, `yarn x` → the tool's own argv. */
function withoutRunner(argv: readonly string[]): readonly string[] {
  const head = baseName(argv[0])
  if (head === "npx" || head === "bunx" || head === "pnpx") return argv.slice(1).filter((arg, index) => index > 0 || !arg.startsWith("-"))
  if ((head === "pnpm" || head === "bun") && (argv[1] === "exec" || argv[1] === "dlx" || argv[1] === "x")) return argv.slice(2)
  if (head === "yarn" && argv[1] && !argv[1].startsWith("-")) return argv.slice(argv[1] === "dlx" || argv[1] === "exec" ? 2 : 1)
  return argv
}

const ORM_RULES: ReadonlyArray<{ readonly match: (argv: readonly string[], joined: string) => boolean; readonly what: string }> = [
  { match: (argv, joined) => baseName(argv[0]) === "prisma" && (/\bmigrate reset\b/.test(joined) || (/\bdb push\b/.test(joined) && joined.includes("--force-reset"))), what: "prisma database reset" },
  { match: (argv, joined) => (baseName(argv[1]) === "artisan" || baseName(argv[0]) === "artisan") && /\b(?:migrate:fresh|migrate:reset|migrate:refresh|db:wipe)\b/.test(joined), what: "Laravel database wipe" },
  { match: (argv, joined) => /^(?:rails|rake)$/.test(baseName(argv[0])) && /\bdb:(?:drop|reset|purge|schema:load|migrate:reset)\b/.test(joined), what: "Rails database drop/reset" },
  { match: (argv, joined) => argv.some((arg) => baseName(arg) === "manage.py") && /\b(?:flush|reset_db|sqlflush)\b/.test(joined), what: "Django database flush" },
  { match: (argv, joined) => /typeorm/.test(baseName(argv[0])) && /\bschema:drop\b/.test(joined), what: "TypeORM schema drop" },
  { match: (argv, joined) => /^sequelize(?:-cli)?$/.test(baseName(argv[0])) && /\bdb:drop\b/.test(joined), what: "Sequelize database drop" },
  { match: (argv, joined) => baseName(argv[0]) === "drizzle-kit" && /\bdrop\b/.test(joined), what: "drizzle-kit drop" },
  { match: (argv, joined) => baseName(argv[0]) === "supabase" && /\bdb reset\b/.test(joined), what: "Supabase database reset" },
  { match: (argv, joined) => baseName(argv[0]) === "knex" && /\bmigrate:rollback\b/.test(joined) && joined.includes("--all"), what: "knex rollback of every migration" },
  { match: (argv, joined) => baseName(argv[0]) === "mix" && /\becto\.(?:drop|reset)\b/.test(joined), what: "Ecto database drop/reset" },
]

const DOCKER_EXEC_VALUED = new Set(["-e", "--env", "-u", "--user", "-w", "--workdir", "--env-file", "--detach-keys", "--index"])

function judgeDocker(command: ShellCommand, ctx: Context, depth: number): void {
  const argv = command.argv
  const compose = baseName(argv[0]) === "docker-compose" || baseName(argv[0]) === "podman-compose" || argv[1] === "compose"
  const rest = baseName(argv[0]).endsWith("compose") ? argv.slice(1) : argv[1] === "compose" ? argv.slice(2) : argv.slice(1)
  // global compose options before the subcommand: -f file, -p project
  let index = 0
  while (index < rest.length && (rest[index] as string).startsWith("-")) index += ["-f", "--file", "-p", "--project-name", "--env-file", "--profile"].includes(rest[index] as string) ? 2 : 1
  const sub = rest[index]
  const args = rest.slice(index + 1)
  if (sub === "exec" || (compose && sub === "run")) {
    let at = 0
    while (at < args.length && (args[at] as string).startsWith("-")) at += DOCKER_EXEC_VALUED.has(args[at] as string) ? 2 : 1
    const inner = args.slice(at + 1)
    if (inner.length > 0) judge({ ...command, argv: inner, wrappers: [...command.wrappers, "docker exec"] }, ctx, depth + 1)
    return
  }
  if (!compose && sub === "volume" && /^(?:rm|remove|prune)$/.test(args[0] ?? "")) {
    const names = args.slice(1).filter((arg) => !arg.startsWith("-"))
    add(ctx, `docker volume ${args[0]}${names.length ? ` ${names.join(" ")}` : ""}`, names.length > 0 && names.every((name) => TEST_NAME.test(name)))
    return
  }
  if (!compose && sub === "system" && args[0] === "prune") return add(ctx, "docker system prune (removes stopped containers, images and possibly volumes)", false)
  if (!compose && sub === "rm" && args.some((arg) => arg === "-v" || arg === "--volumes" || /^-\w*v/.test(arg))) return add(ctx, "docker rm with its volumes", false)
  if (compose && sub === "down" && args.some((arg) => arg === "-v" || arg === "--volumes")) return add(ctx, "docker compose down -v (deletes the volumes and their data)", false)
}

function judgeGit(argv: readonly string[], ctx: Context): void {
  let index = 1
  while (index < argv.length && (argv[index] as string).startsWith("-")) index += argv[index] === "-C" || argv[index] === "-c" ? 2 : 1
  const sub = argv[index]
  const args = argv.slice(index + 1)
  const has = (pattern: RegExp) => args.some((arg) => pattern.test(arg))
  if (sub === "reset" && has(/^--hard$/)) return add(ctx, "git reset --hard (discards uncommitted work)", false)
  if (sub === "clean" && has(/^(?:-\w*f\w*|--force)$/)) return add(ctx, "git clean -f (deletes untracked files)", false)
  if (sub === "push" && has(/^(?:-f|--force|\+\S+)$/) && !has(/^--force-with-lease|^--force-if-includes/)) return add(ctx, "git push --force (rewrites the remote history)", false)
  if (sub === "checkout" && (args.includes(".") || has(/^-f$|^--force$/))) return add(ctx, "git checkout . (discards uncommitted changes)", false)
  if (sub === "restore" && args.includes(".") && !has(/^(?:--staged|-S)$/)) return add(ctx, "git restore . (discards uncommitted changes)", false)
  if (sub === "branch" && (has(/^-D$/) || (has(/^(?:-d|--delete)$/) && has(/^(?:-f|--force)$/)))) return add(ctx, "git branch -D (deletes an unmerged branch)", false)
  if (sub === "stash" && (args[0] === "drop" || args[0] === "clear")) return add(ctx, `git stash ${args[0]} (deletes stashed work)`, false)
}

function judgeRm(argv: readonly string[], ctx: Context): void {
  const flags = argv.slice(1).filter((arg) => arg.startsWith("-"))
  const recursive = flags.some((flag) => /^-\w*[rR]/.test(flag) || flag === "--recursive")
  for (const target of argv.slice(1).filter((arg) => !arg.startsWith("-"))) {
    if (recursive && CATASTROPHIC_PATH.test(target)) add(ctx, `rm -r ${target}`, false)
    else if (DATA_PATH.test(target)) add(ctx, `rm of data: ${target}`, TEST_NAME.test(target))
  }
}

function judgePackageRemoval(argv: readonly string[], ctx: Context): void {
  const name = baseName(argv[0])
  const verb = argv[1] ?? ""
  const removes = (["apt", "apt-get", "dnf", "yum", "zypper"].includes(name) && /^(?:remove|purge|autoremove|erase)$/.test(verb))
    || (name === "pacman" && /^-R/.test(verb))
    || (name === "brew" && /^(?:uninstall|remove|rm)$/.test(verb))
    || (["snap", "choco", "winget", "scoop"].includes(name) && /^(?:remove|uninstall)$/.test(verb))
  if (!removes) return
  const packages = argv.slice(2).filter((arg) => !arg.startsWith("-") && DB_PACKAGE.test(arg))
  if (packages.length > 0) add(ctx, `uninstalling a database server (${packages.join(", ")})`, false)
}

const INTERPRETERS = new Set(["python", "python3", "node", "bun", "deno", "ruby", "php", "perl", "bash", "sh", "zsh"])
const INLINE_FLAGS = new Set(["-c", "-e", "--eval", "-r"])

function judgeScript(command: ShellCommand, ctx: Context): void {
  const name = baseName(command.argv[0])
  if (!INTERPRETERS.has(name)) return
  const args = command.argv.slice(1)
  const inline = args.findIndex((arg) => INLINE_FLAGS.has(arg))
  if (inline !== -1 && !["bash", "sh", "zsh"].includes(name)) {
    for (const operation of codeOperations(args[inline + 1] ?? "")) add(ctx, `${operation} in inline ${name} code`, isTestEnv(command))
    return
  }
  const file = args.find((arg) => !arg.startsWith("-") && arg !== "run" && /\.\w+$/.test(arg))
  const text = file ? readProjectFile(ctx, file) : undefined
  if (text) for (const operation of codeOperations(text)) add(ctx, `${operation} in ${file}`, isTestEnv(command))
}

function judge(command: ShellCommand, ctx: Context, depth: number): void {
  if (depth > 4) return
  const argv = withoutRunner(command.argv)
  const name = baseName(argv[0])
  const joined = argv.join(" ")
  if (CLIENTS[name]) return judgeClient({ ...command, argv }, name, ctx)
  if (name === "mongosh" || name === "mongo") {
    const code = readArgs(argv, new Set(["--eval"])).options.get("--eval")?.join("\n") ?? ""
    const database = readArgs(argv, new Set(["--eval"])).positionals[0] ?? ""
    if (/\bdropDatabase\s*\(|\.drop\s*\(\s*\)|\.deleteMany\s*\(\s*\{\s*\}\s*\)|\.remove\s*\(\s*\{\s*\}\s*\)/.test(code)) add(ctx, `MongoDB drop/delete-all via ${name}`, TEST_NAME.test(database))
    return
  }
  if (name === "redis-cli") {
    if (argv.some((arg) => /^flush(?:all|db)$/i.test(arg)) || (command.stdin && /\bflush(?:all|db)\b/i.test(command.stdin))) add(ctx, "redis FLUSHALL/FLUSHDB", false)
    return
  }
  if (name === "dropdb" || name === "dropuser") {
    const target = argv.slice(1).filter((arg) => !arg.startsWith("-")).at(-1) ?? ""
    return add(ctx, `${name} ${target}`, TEST_NAME.test(target) || isTestEnv(command))
  }
  if (name === "mysqladmin" && argv.includes("drop")) return add(ctx, "mysqladmin drop", TEST_NAME.test(argv.at(-1) ?? ""))
  if (name === "docker" || name === "podman" || name === "docker-compose" || name === "podman-compose") return judgeDocker({ ...command, argv }, ctx, depth)
  if (name === "kubectl" && argv[1] === "exec") {
    const dashes = argv.indexOf("--")
    if (dashes !== -1) judge({ ...command, argv: argv.slice(dashes + 1) }, ctx, depth + 1)
    return
  }
  if (name === "git") return judgeGit(argv, ctx)
  if (name === "rm") return judgeRm(argv, ctx)
  for (const rule of ORM_RULES) {
    if (rule.match(argv, joined)) return add(ctx, rule.what, isTestEnv(command))
  }
  judgePackageRemoval(argv, ctx)
  judgeScript({ ...command, argv }, ctx)
}

const DESTRUCTIVE_WORD = /\b(?:drop|truncate|prune|flushall|flushdb|wipe|migrate:fresh|reset\s+--hard|rm\s+-\w*r)\b/i

export function destructiveFindings(line: string, options: DestructiveOptions): DestructiveFinding[] {
  const parsed = parseShell(line)
  const ctx: Context = { options, findings: [] }
  if (!parsed.ok && DESTRUCTIVE_WORD.test(line)) return [{ what: "a command that cannot be read reliably and looks destructive", test: false }]
  for (const command of parsed.commands) judge(command, ctx, 0)
  return ctx.findings
}
