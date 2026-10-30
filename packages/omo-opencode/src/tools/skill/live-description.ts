/**
 * The skill tool's current description (real-config context probe, 12-10-2026). OpenCode copies a plugin tool's
 * description once, when it registers the tool (tool/registry.ts:142 in 1.18.26), before the plugin can ask OpenCode
 * which skills it lists natively (OpenCode does not answer yet while plugins load); the tool.definition hook runs on
 * every request (registry.ts:318), when OpenCode answers, and hands this one out instead, so skills already in
 * <available_skills> are not sent twice.
 */
let source: (() => Promise<string | undefined>) | undefined

export const liveSkillDescription = {
  set(next: (() => Promise<string | undefined>) | undefined): void {
    source = next
  },
  async get(): Promise<string | undefined> {
    return source?.()
  },
}
