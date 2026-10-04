import type { Limits } from "./config"

export class ValidationError extends Error {
  override name = "ValidationError"
}

export type PostInput = { readonly title: string; readonly tags: readonly string[] }

export function validatePost(post: PostInput, limits: Limits): void {
  const title = post.title.trim()
  if (title.length === 0) throw new ValidationError("title: required")
  if (title.length > limits.maxTitleLength) {
    throw new ValidationError(`title: too long (${title.length} > ${limits.maxTitleLength})`)
  }
  if (post.tags.length > limits.maxTags) {
    throw new ValidationError(`tags: too many tags (${post.tags.length} > ${limits.maxTags})`)
  }
  for (const tag of post.tags) {
    if (!/^[a-z0-9-]+$/.test(tag)) throw new ValidationError(`tags: invalid tag "${tag}"`)
  }
}
