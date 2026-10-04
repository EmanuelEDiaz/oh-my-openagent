import { expect, test } from "bun:test"

import { createPost } from "../src/posts"

test("creates a post with a couple of tags", () => {
  const post = createPost({ title: "Hello world", tags: ["intro", "news"] }, {})
  expect(post.slug).toBe("hello-world")
})

test("rejects bad tags", () => {
  expect(() => createPost({ title: "Hi", tags: ["Bad Tag"] }, {})).toThrow("invalid tag")
})
