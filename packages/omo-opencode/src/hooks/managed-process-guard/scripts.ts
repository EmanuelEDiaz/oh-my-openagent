import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

const MAX_SCRIPT_BYTES = 64 * 1024
// `sh x.sh`, `bash -e x.sh`, `source x`, `. x`, or a path run directly (`./x.sh`, `/tmp/x.sh`).
const VIA_SHELL = /(?:^|\s)(?:sh|bash|zsh|dash|source|\.)\s+(?:-\w+\s+)*([^\s;&|'"]+)/g
const DIRECT = /(?:^|[\s;&|])((?:\.{1,2}\/|\/)[^\s;&|'"]+\.(?:sh|bash|zsh))\b/g

/**
 * The text of local scripts the command runs, so a blocked command cannot be moved into a file and run from there
 * (fork incident H50). Missing, unreadable or large files are skipped.
 */
export function referencedScripts(command: string, baseDir: string): string {
  const paths = new Set<string>()
  for (const pattern of [VIA_SHELL, DIRECT]) {
    for (const match of command.matchAll(pattern)) if (match[1] && match[1] !== "-c") paths.add(match[1])
  }
  const texts: string[] = []
  for (const path of paths) {
    const file = isAbsolute(path) ? path : resolve(baseDir, path)
    try {
      if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > MAX_SCRIPT_BYTES) continue
      texts.push(readFileSync(file, "utf8"))
    } catch {
      continue
    }
  }
  return texts.join("\n")
}
