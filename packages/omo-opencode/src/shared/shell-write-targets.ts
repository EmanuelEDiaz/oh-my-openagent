/**
 * Files a bash command rewrites in place (fork plan docs/fork/plans/shell-writes.md): a redirect to a path, `sed -i`,
 * `perl -i` and `tee`. Only files that already exist inside the project count: new files, `/dev/*`, descriptor
 * duplication (`2>&1`) and paths outside the project (`/tmp`) are not rewrites of the user's code.
 */
import { existsSync, statSync } from "node:fs"
import { isAbsolute, resolve, sep } from "node:path"

type Token = { text: string; operator: boolean }

const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g
const OPERATORS = ["&>>", "&>", ">>", "||", "&&", ">|", "<<", ">", "<", "|", ";", "&", "\n"]
const SEPARATORS = new Set(["||", "&&", "|", ";", "&", "\n"])
const WRITES = new Set([">", ">>", ">|", "&>", "&>>"])

/** Drops heredoc bodies: their text is data, never part of the command. */
function withoutHeredocBodies(command: string): string {
  const lines = command.split("\n")
  const kept: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ""
    kept.push(line)
    const delimiters = [...line.matchAll(HEREDOC)].map((match) => ({ word: match[2] ?? "", dash: match[0].startsWith("<<-") }))
    for (const { word, dash } of delimiters) {
      while (index + 1 < lines.length) {
        index++
        const body = lines[index] ?? ""
        if ((dash ? body.trimStart() : body) === word) break
      }
    }
  }
  return kept.join("\n")
}

function tokenize(command: string): Token[] {
  const tokens: Token[] = []
  let word = ""
  let started = false
  const flush = () => {
    if (started) tokens.push({ text: word, operator: false })
    word = ""
    started = false
  }
  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? ""
    if (char === "'" || char === '"') {
      const end = command.indexOf(char, index + 1)
      word += command.slice(index + 1, end === -1 ? command.length : end)
      started = true
      index = end === -1 ? command.length : end
      continue
    }
    if (char === "\\" && index + 1 < command.length) {
      word += command[index + 1]
      started = true
      index++
      continue
    }
    const operator = OPERATORS.find((candidate) => command.startsWith(candidate, index))
    if (operator !== undefined) {
      // `2>file` and `2>&1` write to a descriptor other than stdout: not a rewrite of a source file.
      const descriptor = started && /^\d+$/.test(word) && operator.startsWith(">") ? word : undefined
      if (descriptor !== undefined) {
        word = ""
        started = false
      } else {
        flush()
      }
      const duplicate = command[index + operator.length] === "&"
      tokens.push({ text: descriptor !== undefined && descriptor !== "1" ? `fd${operator}` : duplicate ? `${operator}&` : operator, operator: true })
      index += operator.length - 1 + (duplicate ? 1 : 0)
      continue
    }
    if (char === " " || char === "\t") {
      flush()
      continue
    }
    word += char
    started = true
  }
  flush()
  return tokens
}

/** Words of a command that name files edited in place by `sed -i`, `perl -i` or `tee`. */
function inPlaceFiles(words: readonly string[]): string[] {
  const [name, ...args] = words.filter((word, index) => !(index === 0 && /^\w+=/.test(word)))
  if (name === "tee") return args.filter((arg) => !arg.startsWith("-"))
  if (name !== "sed" && name !== "perl") return []
  const inPlace = args.some((arg) => arg === "--in-place" || arg.startsWith("--in-place=") || /^-[A-Za-z]*i/.test(arg))
  if (!inPlace) return []
  const files: string[] = []
  let scriptGiven = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? ""
    if (arg === "-e" || arg === "-f" || arg === "--expression" || arg === "--file") {
      scriptGiven = true
      index++
      continue
    }
    if (/^-[A-Za-z]*e$/.test(arg)) {
      scriptGiven = true
      index++
      continue
    }
    if (arg.startsWith("-")) continue
    if (!scriptGiven && name === "sed") {
      scriptGiven = true
      continue
    }
    files.push(arg)
  }
  return files
}

export function shellWriteTargets(command: string, directory: string): string[] {
  const root = resolve(directory)
  const found: string[] = []
  const add = (path: string) => {
    if (path === "" || path.startsWith("/dev/")) return
    const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
    if (!absolute.startsWith(`${root}${sep}`)) return
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return
    if (!found.includes(absolute)) found.push(absolute)
  }
  let words: string[] = []
  const endCommand = () => {
    for (const file of inPlaceFiles(words)) add(file)
    words = []
  }
  const tokens = tokenize(withoutHeredocBodies(command))
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === undefined) continue
    if (!token.operator) {
      words.push(token.text)
      continue
    }
    if (SEPARATORS.has(token.text)) {
      endCommand()
      continue
    }
    const next = tokens[index + 1]
    if (next !== undefined && !next.operator) {
      if (WRITES.has(token.text)) add(next.text)
      index++
    }
  }
  endCommand()
  return found
}
