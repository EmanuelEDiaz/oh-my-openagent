import { expect, test } from "bun:test"

import { getUser, HttpError } from "../src/users"

test("a user that does not exist is null, not a crash", async () => {
  expect(await getUser("42", async () => {
    throw new HttpError(404)
  })).toBeNull()
})
