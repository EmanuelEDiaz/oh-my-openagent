import { checkExternalTools, createCheckDeps, doctorIssues, doctorLines } from "../../../features/external-tools"
import type { CheckResult } from "../framework/types"

export const EXTERNAL_TOOLS_CHECK_ID = "external-tools"
export const EXTERNAL_TOOLS_CHECK_NAME = "External Tools"

/**
 * Every external tool the current project needs, plus the optional ones, each started for real (fork roadmap 0.25): a
 * language server must answer the LSP handshake, a command must run. Fresh, never from the startup cache.
 */
export async function checkExternalToolsForDoctor(projectDir: string = process.cwd()): Promise<CheckResult> {
  const started = Date.now()
  const reports = await checkExternalTools(projectDir, createCheckDeps(), { includeOptional: true })
  const issues = doctorIssues(reports)
  return {
    name: EXTERNAL_TOOLS_CHECK_NAME,
    status: issues.length > 0 ? "warn" : "pass",
    message: issues.length === 0 ? `${reports.length} tools connect` : `${issues.length} of ${reports.length} tools missing or not connecting`,
    details: doctorLines(reports),
    issues,
    duration: Date.now() - started,
  }
}
