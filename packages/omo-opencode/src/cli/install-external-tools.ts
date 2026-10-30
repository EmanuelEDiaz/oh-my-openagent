import { checkTools, createCheckDeps, doctorIssues, EXTERNAL_TOOLS, type CheckDeps } from "../features/external-tools"

/**
 * At install time there is no project yet (fork roadmap 0.25): the TypeScript server, git and the optional tools are
 * checked for real, and each one missing or not connecting is reported with what stops working and how to install it
 * durably. Other language servers are reported per project, at OpenCode startup and in doctor.
 */
export async function reportExternalToolsAtInstall(options: { log: (message: string) => void; deps?: CheckDeps; directory?: string }): Promise<number> {
  const tools = EXTERNAL_TOOLS.filter((tool) => tool.need.kind !== "language" || tool.need.language === "typescript")
  const reports = await checkTools(tools, options.directory ?? process.cwd(), options.deps ?? createCheckDeps())
  const issues = doctorIssues(reports)
  for (const issue of issues) options.log(`${issue.title}. ${issue.description}\n  Fix: ${issue.fix.replaceAll("\n", "\n  ")}`)
  return issues.length
}
