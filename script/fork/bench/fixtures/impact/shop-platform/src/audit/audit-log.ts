export type AuditEntry = { at: string; actor: string; action: string; target: string }

const entries: AuditEntry[] = []

export function audit(entry: AuditEntry): void {
  entries.push(entry)
}

export function auditTrail(target: string): AuditEntry[] {
  return entries.filter((entry) => entry.target === target)
}
