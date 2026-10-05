export const ROLE_GRANTS: Readonly<Record<string, { readonly inherits?: string; readonly grants: readonly string[] }>> = {
  viewer: { grants: ["read"] },
  editor: { inherits: "viewer", grants: ["write"] },
  admin: { inherits: "editor", grants: ["delete", "invite"] },
}

export function expandRole(role: string, seen = new Set<string>()): string[] {
  const entry = ROLE_GRANTS[role]
  if (!entry || seen.has(role)) return []
  seen.add(role)
  return [...entry.grants, ...(entry.inherits ? expandRole(entry.inherits, seen) : [])]
}
