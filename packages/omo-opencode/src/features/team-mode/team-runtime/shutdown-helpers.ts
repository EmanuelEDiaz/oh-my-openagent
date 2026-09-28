import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import path from "node:path"

import { removeWorktree } from "../team-worktree/cleanup"
import type { Message, RuntimeState } from "../types"

export const DELETABLE_MEMBER_STATUSES = new Set<RuntimeState["members"][number]["status"]>([
  "completed",
  "shutdown_approved",
  "errored",
])

export function createShutdownMessage(from: string, to: string, kind: Message["kind"], body: string): Message {
  return {
    version: 1,
    messageId: randomUUID(),
    from,
    to,
    kind,
    body,
    timestamp: Date.now(),
  }
}

export function getRuntimeMember(runtimeState: RuntimeState, memberName: string): RuntimeState["members"][number] {
  const member = runtimeState.members.find((candidate) => candidate.name === memberName)
  if (!member) {
    throw new Error(`unknown member '${memberName}'`)
  }

  return member
}

export function getLeadMemberName(runtimeState: RuntimeState): string {
  const leadMember = runtimeState.members.find((member) => member.agentType === "leader")
  if (!leadMember) {
    throw new Error(`team '${runtimeState.teamRunId}' is missing a lead member`)
  }

  return leadMember.name
}

export function createSendContext(
  runtimeState: RuntimeState,
  senderName: string,
): { isLead: boolean; activeMembers: string[] } {
  const sender = getRuntimeMember(runtimeState, senderName)
  return {
    isLead: sender.agentType === "leader",
    activeMembers: runtimeState.members.map((member) => member.name),
  }
}

export function findLatestShutdownRequestIndex(
  runtimeState: RuntimeState,
  memberName: string,
  requesterName?: string,
): number {
  for (let index = runtimeState.shutdownRequests.length - 1; index >= 0; index -= 1) {
    const shutdownRequest = runtimeState.shutdownRequests[index]
    if (shutdownRequest.memberId !== memberName) continue
    if (requesterName !== undefined && shutdownRequest.requesterName !== requesterName) continue
    return index
  }

  return -1
}

export type WorktreeRemovalReport = {
  readonly removed: string[]
  readonly preserved: { readonly path: string; readonly reason: string }[]
}

/** Removes member worktrees through git; anything git does not confirm as a clean linked worktree is kept. */
export async function removeWorktrees(memberPaths: Array<string | undefined>): Promise<WorktreeRemovalReport> {
  const report: WorktreeRemovalReport = { removed: [], preserved: [] }

  for (const memberPath of new Set(memberPaths)) {
    if (!memberPath) continue
    try {
      await removeWorktree(memberPath)
      report.removed.push(memberPath)
    } catch (error) {
      report.preserved.push({ path: memberPath, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  return report
}

/** Deletes the plugin-owned runtime state directory, refusing any path outside the team-mode base dir. */
export async function removeRuntimeStateDir(runtimeStateDir: string, baseDir: string): Promise<void> {
  const relative = path.relative(path.resolve(baseDir), path.resolve(runtimeStateDir))
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing to delete ${runtimeStateDir}: it is not inside the team-mode base dir ${baseDir}`)
  }
  await rm(runtimeStateDir, { recursive: true, force: true })
}
