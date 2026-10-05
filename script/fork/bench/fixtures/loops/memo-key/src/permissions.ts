import { memoize } from "./memo"
import { expandRole } from "./roles"

export type User = { readonly id: number; readonly roles: readonly string[] }

export const permissionsFor = memoize((user: User): string[] => {
  const all = new Set(user.roles.flatMap((role) => expandRole(role)))
  return [...all].sort()
})

export function can(user: User, permission: string): boolean {
  return permissionsFor(user).includes(permission)
}
