/** Errors of one file from the plugin's LSP daemon, for edits OpenCode returns without diagnostics (fork roadmap 0.9a). */
import { existsSync } from "node:fs"
import { extname } from "node:path"
import { pathToFileURL } from "node:url"

import { createLspDaemonContext, resolveLspDaemonClientPath } from "../../mcp/lsp"
import { log } from "../../shared/logger"
import type { LspDiagnostic } from "./diagnostics"

type DaemonClient = {
  readonly callToolViaDaemon: (
    name: string,
    args: Record<string, unknown>,
    options: { readonly context: unknown; readonly signal?: AbortSignal },
  ) => Promise<{ readonly content: readonly { readonly type: string; readonly text?: string }[]; readonly isError?: boolean; readonly details?: unknown }>
}

const TIMEOUT_MS = 20_000
/** Only source files have a language server; anything else would start the daemon for nothing. */
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".php", ".rb", ".java", ".kt", ".cs", ".vue", ".svelte"])
/** A missing language server is asked about again only after this long. */
const UNAVAILABLE_RETRY_MS = 10 * 60_000
const LINE = /^(error|warning|information|info|hint)(?:\[[^\]]*\])?(?: \(([^)]+)\))? at (\d+):(\d+): (.+)$/i

/** Parses the daemon's `error[source] (code) at line:col: message` lines (line is 1-based, column 0-based). */
export function parseDaemonDiagnostics(text: string): LspDiagnostic[] {
  const found: LspDiagnostic[] = []
  for (const raw of text.split(/\r?\n/)) {
    const match = LINE.exec(raw.trim())
    if (!match) continue
    const severity = /^error/i.test(match[1] ?? "") ? 1 : /^warn/i.test(match[1] ?? "") ? 2 : 3
    found.push({
      range: { start: { line: Number(match[3]) - 1, character: Number(match[4]) } },
      message: match[5] ?? "",
      severity,
      ...(match[2] ? { code: /^\d+$/.test(match[2]) ? Number(match[2]) : match[2] } : {}),
    })
  }
  return found
}

/** `onUnavailable` is told once per file type when its language server is missing, with the daemon's install hint. */
export function createDaemonDiagnostics(
  directory: string,
  onUnavailable?: (extension: string, hint: string) => void,
): (path: string) => Promise<LspDiagnostic[] | undefined> {
  let client: Promise<DaemonClient | undefined> | undefined
  const queried = new Set<string>()
  const unavailableUntil = new Map<string, number>()
  const load = () => {
    client ??= (async () => {
      const path = resolveLspDaemonClientPath()
      if (!path || !existsSync(path)) return undefined
      const loaded = (await import(pathToFileURL(path).href)) as Partial<DaemonClient>
      return typeof loaded.callToolViaDaemon === "function" ? (loaded as DaemonClient) : undefined
    })().catch((error) => {
      log("[edit-diagnostics] LSP daemon client unavailable", { error: String(error) })
      return undefined
    })
    return client
  }
  return async (path) => {
    const ext = extname(path).toLowerCase()
    if (!CODE_EXTENSIONS.has(ext) || (unavailableUntil.get(ext) ?? 0) > Date.now()) return undefined
    const daemon = await load()
    if (!daemon) return undefined
    const result = await daemon.callToolViaDaemon("diagnostics", { filePath: path, severity: "error" }, {
      context: createLspDaemonContext(directory),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = result.content.map((block) => block.text ?? "").join("\n")
    if (result.isError && !/NOT INSTALLED|not configured|Request initialize failed/i.test(text)) return undefined
    // No language server for this file type: unknown, not "no errors".
    if (/NOT INSTALLED|not configured|Request initialize failed/i.test(text)) {
      if (!unavailableUntil.has(ext)) onUnavailable?.(ext, text.split(/\n\s*\n/).slice(0, 3).join("\n").trim())
      unavailableUntil.set(ext, Date.now() + UNAVAILABLE_RETRY_MS)
      return undefined
    }
    const details = result.details as { diagnostics?: unknown } | undefined
    const list = Array.isArray(details?.diagnostics)
      ? (details.diagnostics as { diagnostic?: LspDiagnostic }[]).map((item) => item.diagnostic ?? (item as LspDiagnostic))
      : parseDaemonDiagnostics(text)
    // A cold server answers its first query before it has analysed the file: an empty first answer means "unknown".
    const first = !queried.has(path)
    queried.add(path)
    return first && list.length === 0 ? undefined : list
  }
}
