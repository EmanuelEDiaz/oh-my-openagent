/**
 * Syntax checks that need no language server (fork roadmap 0.9a): Python, Go and strict JSON. TS/JS syntax comes from
 * OpenCode's LSP diagnostics instead. A checker that is not installed reports nothing.
 */
import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"

import { spawnSync } from "../../shared/bun-spawn-shim"

export type SyntaxProblem = { readonly line?: number; readonly message: string }

const PYTHON_CHECK = "import ast,sys\nsrc=open(sys.argv[1],encoding='utf-8').read()\ntry:\n ast.parse(src,sys.argv[1])\nexcept SyntaxError as e:\n print(f'{e.lineno}\\t{e.msg}');sys.exit(3)"

function run(command: string[]): { code: number; out: string } | undefined {
  try {
    const result = spawnSync(command, { stdout: "pipe", stderr: "pipe" })
    return { code: result.exitCode, out: `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}` }
  } catch {
    return undefined
  }
}

function checkPython(path: string): SyntaxProblem | undefined {
  for (const python of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
    const result = run([python, "-c", PYTHON_CHECK, path])
    if (!result) continue
    if (result.code === 3) {
      const [line, message] = result.out.trim().split("\t")
      return { ...(Number(line) ? { line: Number(line) } : {}), message: message ?? result.out.trim() }
    }
    return undefined
  }
  return undefined
}

function checkGo(path: string): SyntaxProblem | undefined {
  const result = run(["gofmt", "-e", "-l", path])
  if (!result || result.code === 0) return undefined
  const match = /:(\d+):\d+: (.+)/.exec(result.out)
  return match ? { line: Number(match[1]), message: match[2] ?? result.out.trim() } : undefined
}

function checkJson(path: string): SyntaxProblem | undefined {
  const name = basename(path).toLowerCase()
  // tsconfig/jsconfig and editor settings allow comments; only strict JSON is checked.
  if (/^(?:tsconfig|jsconfig)\b/.test(name) || path.replace(/\\/g, "/").includes("/.vscode/")) return undefined
  try {
    JSON.parse(readFileSync(path, "utf8"))
    return undefined
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) }
  }
}

export function hasStandaloneChecker(path: string): boolean {
  return [".py", ".go", ".json"].includes(extname(path).toLowerCase())
}

export function checkSyntax(path: string): SyntaxProblem | undefined {
  const ext = extname(path).toLowerCase()
  if (ext === ".py") return checkPython(path)
  if (ext === ".go") return checkGo(path)
  if (ext === ".json") return checkJson(path)
  return undefined
}
