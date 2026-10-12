/**
 * The skill tool's current description (real-config context probe, 12-10-2026). OpenCode copies a plugin tool's
 * description once, when it registers the tool (tool/registry.ts:142 in 1.18.26), before the plugin knows which
 * skills OpenCode lists natively; the tool.definition hook runs on every request (registry.ts:318) and hands this
 * one out instead, so skills already in <available_skills> are not sent twice.
 */
let source: (() => string | undefined) | undefined

export const liveSkillDescription = {
  set(next: (() => string | undefined) | undefined): void {
    source = next
  },
  get(): string | undefined {
    return source?.()
  },
}
