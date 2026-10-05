function escapeLiteral(text: string): string {
  return text.replace(/[+^${}()|[\]\\]/g, "\\$&")
}

export function globToRegExp(pattern: string): RegExp {
  let source = ""
  for (const char of pattern) {
    if (char === "*") source += "[^/]*"
    else if (char === "?") source += "[^/]"
    else source += escapeLiteral(char)
  }
  return new RegExp(`^${source}$`)
}

export function matches(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path)
}
