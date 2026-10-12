export type User = { readonly id: string; readonly name: string }

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

export class UserLoadError extends Error {}

export type FetchJson = (url: string) => Promise<unknown>

export async function getUser(id: string, fetchJson: FetchJson): Promise<User | null> {
  const data = await fetchJson(`/api/users/${id}`)
  return data as User
}
