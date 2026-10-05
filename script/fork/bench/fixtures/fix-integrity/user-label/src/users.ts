export type User = { readonly id: number; readonly name: string; readonly nickname?: string }

export function displayName(user: User): string {
  const nickname: string = user.nickname
  return nickname.trim() || user.name
}

export function labels(users: readonly User[]): string[] {
  return users.map((user) => `${displayName(user)} (#${user.id})`)
}
