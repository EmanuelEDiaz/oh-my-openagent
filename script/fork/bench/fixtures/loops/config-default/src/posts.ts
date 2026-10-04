import { loadLimits } from "./config"
import type { Env } from "./env"
import { validatePost, type PostInput } from "./validate"

export type Post = PostInput & { readonly slug: string }

export function createPost(input: PostInput, env: Env = process.env): Post {
  validatePost(input, loadLimits(env))
  return { ...input, slug: input.title.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-") }
}
