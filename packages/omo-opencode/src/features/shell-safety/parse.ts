/**
 * A small POSIX shell reader for the safety guards (fork roadmap 0.21, entrega 1; the user chose an own parser over
 * tree-sitter, 11-10-2026). It is not a shell: it finds every simple command a line would run, including those inside
 * `$( )`, backticks, `bash -c '…'` and `eval`, and behind wrappers (`sudo`, `env`, `nohup`, `timeout`, `xargs`…), so a
 * guard judges the real command. Arguments built at run time (`$VAR`, `$( )`, xargs input) are marked dynamic. When the
 * text cannot be read (an unterminated quote or substitution) `ok` is false and the caller must not guess.
 */
export type ShellCommand = {
  readonly argv: readonly string[]
  /** An argument is only known at run time (`$VAR`, `$( )`, backticks, xargs input). */
  readonly dynamic: boolean
  /** Leading `NAME=value` assignments. */
  readonly env: Readonly<Record<string, string>>
  /** Wrappers that were removed, outermost first (`sudo`, `env`, `xargs`…). */
  readonly wrappers: readonly string[]
  /** Heredoc or here-string text fed to the command. */
  readonly stdin?: string
}

export type ParsedShell = { readonly ok: boolean; readonly commands: readonly ShellCommand[] }

/** `plain` is the text before the first quote, so `FOO='a b'` is still seen as an assignment. */
type Word = { text: string; dynamic: boolean; quoted: boolean; plain: string }
type Raw = { words: Word[]; stdin?: string; heredoc?: { delimiter: string; strip: boolean } }

const MAX_DEPTH = 8

/** Index of the `)` that closes the `(` at `open`, skipping quotes and nested parentheses; -1 when unbalanced. */
function closingParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === "\\") {
      i++
      continue
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1)
      if (end === -1) return -1
      i = end
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1
      if (j >= text.length) return -1
      i = j
      continue
    }
    if (ch === "(") depth++
    else if (ch === ")" && --depth === 0) return i
  }
  return -1
}

function closingBacktick(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") i++
    else if (text[i] === "`") return i
  }
  return -1
}

function lex(text: string, depth: number, nested: ShellCommand[]): { raws: Raw[]; ok: boolean } {
  const raws: Raw[] = [{ words: [] }]
  let ok = true
  let word: Word | undefined
  let redirectTarget = false
  let hereString = false
  const current = () => raws[raws.length - 1] as Raw
  const finishWord = () => {
    if (!word) return
    if (hereString) current().stdin = word.text
    else if (redirectTarget && current().heredoc === undefined) {
      // a file target of > or <: not an argument
    } else if (redirectTarget) {
      const doc = current().heredoc
      if (doc && doc.delimiter === "") doc.delimiter = word.text
    } else current().words.push(word)
    redirectTarget = false
    hereString = false
    word = undefined
  }
  const startWord = () => (word ??= { text: "", dynamic: false, quoted: false, plain: "" })
  const newCommand = () => {
    finishWord()
    if (current().words.length > 0 || current().stdin !== undefined) raws.push({ words: [] })
  }
  const substitute = (script: string) => {
    const inner = parseScript(script, depth + 1)
    if (!inner.ok) ok = false
    nested.push(...inner.commands)
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    const next = text[i + 1]
    if (ch === "\\") {
      if (next === "\n") {
        i += 2
        continue
      }
      startWord().text += next ?? ""
      i += 2
      continue
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1)
      if (end === -1) return { raws, ok: false }
      const w = startWord()
      if (!w.quoted) w.plain = w.text
      w.text += text.slice(i + 1, end)
      w.quoted = true
      i = end + 1
      continue
    }
    if (ch === '"') {
      const w = startWord()
      if (!w.quoted) w.plain = w.text
      w.quoted = true
      let j = i + 1
      for (;;) {
        if (j >= text.length) return { raws, ok: false }
        const c = text[j] as string
        if (c === '"') break
        if (c === "\\" && /["\\$`\n]/.test(text[j + 1] ?? "")) {
          w.text += text[j + 1]
          j += 2
          continue
        }
        if (c === "$" && text[j + 1] === "(") {
          const close = closingParen(text, j + 1)
          if (close === -1) return { raws, ok: false }
          substitute(text.slice(j + 2, close))
          w.dynamic = true
          w.text += text.slice(j, close + 1)
          j = close + 1
          continue
        }
        if (c === "`") {
          const close = closingBacktick(text, j)
          if (close === -1) return { raws, ok: false }
          substitute(text.slice(j + 1, close))
          w.dynamic = true
          w.text += text.slice(j, close + 1)
          j = close + 1
          continue
        }
        if (c === "$" && /[\w{@*#?$!-]/.test(text[j + 1] ?? "")) w.dynamic = true
        w.text += c
        j++
      }
      i = j + 1
      continue
    }
    if (ch === "$" && next === "(") {
      const close = closingParen(text, i + 1)
      if (close === -1) return { raws, ok: false }
      if (text[i + 2] !== "(") substitute(text.slice(i + 2, close))
      const w = startWord()
      w.dynamic = true
      w.text += text.slice(i, close + 1)
      i = close + 1
      continue
    }
    if (ch === "`") {
      const close = closingBacktick(text, i)
      if (close === -1) return { raws, ok: false }
      substitute(text.slice(i + 1, close))
      const w = startWord()
      w.dynamic = true
      w.text += text.slice(i, close + 1)
      i = close + 1
      continue
    }
    if (ch === "$" && /[\w{@*#?$!-]/.test(next ?? "")) {
      const w = startWord()
      w.dynamic = true
      w.text += ch
      i++
      continue
    }
    if (ch === "#" && !word) {
      const end = text.indexOf("\n", i)
      i = end === -1 ? text.length : end
      continue
    }
    if (ch === "\n") {
      finishWord()
      const doc = current().heredoc
      if (doc && doc.delimiter !== "") {
        const lines: string[] = []
        let j = i + 1
        let closed = false
        while (j <= text.length) {
          const end = text.indexOf("\n", j)
          const line = text.slice(j, end === -1 ? text.length : end)
          j = end === -1 ? text.length + 1 : end + 1
          if ((doc.strip ? line.replace(/^\t+/, "") : line) === doc.delimiter) {
            closed = true
            break
          }
          lines.push(line)
        }
        if (!closed) ok = false
        current().stdin = lines.join("\n")
        current().heredoc = undefined
        newCommand()
        i = Math.min(j - 1, text.length)
        if (i < text.length && text[i] !== "\n") continue
        i++
        continue
      }
      newCommand()
      i++
      continue
    }
    if (ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")" || ch === "{" && !word && /\s/.test(next ?? "") || ch === "}" && !word) {
      if (ch === "&" && next === ">") {
        finishWord()
        redirectTarget = true
        i += text[i + 2] === ">" ? 3 : 2
        continue
      }
      newCommand()
      i += (ch === "&" && next === "&") || (ch === "|" && (next === "|" || next === "&")) || (ch === ";" && next === ";") ? 2 : 1
      continue
    }
    if (ch === ">" || ch === "<") {
      // `2>` / `2>&1`: the digits before the operator name a file descriptor, not an argument.
      if (word && /^\d+$/.test(word.text) && !word.quoted) word = undefined
      finishWord()
      if (ch === "<" && next === "<" && text[i + 2] === "<") {
        hereString = true
        i += 3
        continue
      }
      if (ch === "<" && next === "<") {
        const strip = text[i + 2] === "-"
        current().heredoc = { delimiter: "", strip }
        redirectTarget = true
        i += strip ? 3 : 2
        continue
      }
      let j = i + 1
      if (text[j] === ">" || text[j] === "|") j++
      if (text[j] === "&") {
        j++
        while (/[\d-]/.test(text[j] ?? "")) j++
        i = j
        continue
      }
      redirectTarget = true
      i = j
      continue
    }
    if (/\s/.test(ch)) {
      finishWord()
      i++
      continue
    }
    startWord().text += ch
    i++
  }
  finishWord()
  if (current().heredoc) ok = false
  return { raws: raws.filter((raw) => raw.words.length > 0), ok }
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "fish"])
/** Simple PowerShell commands (`Stop-Process -Name node`) read the same way. */
const POWERSHELLS = new Set(["pwsh", "powershell", "pwsh.exe", "powershell.exe"])
const PLAIN_WRAPPERS = new Set(["nohup", "time", "command", "exec", "builtin", "unbuffer"])

/** Options that take a separate value, per wrapper. */
const VALUE_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T", "--user", "--group"]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S", "--unset", "--chdir"]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
  nice: new Set(["-n", "--adjustment"]),
  ionice: new Set(["-c", "-n", "-p", "--class", "--classdata"]),
  stdbuf: new Set(["-i", "-o", "-e"]),
  setsid: new Set([]),
  xargs: new Set(["-n", "-I", "-P", "-L", "-d", "-a", "-E", "-s", "--max-args", "--max-procs", "--delimiter", "--arg-file", "--replace"]),
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function unwrap(raw: Raw, depth: number, out: ShellCommand[]): boolean {
  let words = [...raw.words]
  const env: Record<string, string> = {}
  const wrappers: string[] = []
  let dynamicInput = false
  let ok = true
  for (;;) {
    while (words[0] && ASSIGNMENT.test(words[0].quoted ? words[0].plain : words[0].text)) {
      const [name, ...value] = (words.shift() as Word).text.split("=")
      env[name as string] = value.join("=")
    }
    const head = words[0]?.text
    if (head === undefined) break
    const name = head.replace(/^.*\//, "")
    if (SHELLS.has(name) || POWERSHELLS.has(name.toLowerCase())) {
      const isPowerShell = POWERSHELLS.has(name.toLowerCase())
      const flag = words.findIndex((word, index) => index > 0 && (isPowerShell ? /^-(?:c|command)$/i.test(word.text) : /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word.text)))
      const script = flag === -1 ? undefined : words[flag + 1]
      if (script) {
        const inner = parseScript(script.text, depth + 1)
        out.push(...inner.commands)
        return inner.ok
      }
      break
    }
    if (name === "eval") {
      const inner = parseScript(words.slice(1).map((word) => word.text).join(" "), depth + 1)
      out.push(...inner.commands)
      return inner.ok && !words.slice(1).some((word) => word.dynamic)
    }
    if (PLAIN_WRAPPERS.has(name)) {
      wrappers.push(name)
      words = words.slice(1)
      continue
    }
    const valued = VALUE_OPTIONS[name]
    if (valued) {
      wrappers.push(name)
      let index = 1
      while (index < words.length) {
        const text = (words[index] as Word).text
        if (text === "--") {
          index++
          break
        }
        if (name === "env" && ASSIGNMENT.test(text)) {
          const [key, ...value] = text.split("=")
          env[key as string] = value.join("=")
          index++
          continue
        }
        if (!text.startsWith("-") || text === "-") break
        index += valued.has(text) ? 2 : 1
      }
      // timeout DURATION, nice -N: a bare value before the command.
      if (name === "timeout" && index < words.length) index++
      if (name === "xargs") dynamicInput = true
      words = words.slice(index)
      continue
    }
    break
  }
  if (words.length === 0) return ok
  out.push({
    argv: words.map((word) => word.text),
    dynamic: dynamicInput || words.slice(1).some((word) => word.dynamic),
    env,
    wrappers,
    ...(raw.stdin !== undefined ? { stdin: raw.stdin } : {}),
  })
  return ok
}

function parseScript(text: string, depth: number): ParsedShell {
  if (depth > MAX_DEPTH) return { ok: false, commands: [] }
  const nested: ShellCommand[] = []
  const { raws, ok } = lex(text, depth, nested)
  const commands: ShellCommand[] = []
  let allOk = ok
  for (const raw of raws) if (!unwrap(raw, depth, commands)) allOk = false
  return { ok: allOk, commands: [...commands, ...nested] }
}

export function parseShell(command: string): ParsedShell {
  return parseScript(command, 0)
}
