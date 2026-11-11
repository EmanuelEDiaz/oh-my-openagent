import { expect, test } from "bun:test"

import { getUser, HttpError, UserLoadError } from "../src/users"

test("hidden: a found user is returned", async () => expect(await getUser("1", async () => ({ id: "1", name: "Ana" }))).toEqual({ id: "1", name: "Ana" }))
test("hidden: a server error is a UserLoadError caused by it", async () => {
  const failure = new HttpError(500)
  const result = getUser("1", async () => {
    throw failure
  })
  await expect(result).rejects.toBeInstanceOf(UserLoadError)
  await result.catch((error: Error) => expect(error.cause).toBe(failure))
})
test("hidden: the network being down is not 'not found'", async () => {
  const offline = new TypeError("fetch failed")
  const result = getUser("1", async () => {
    throw offline
  })
  await expect(result).rejects.toBeInstanceOf(UserLoadError)
  await result.catch((error: Error) => expect(error.cause).toBe(offline))
})
test("hidden: it asks for the right user", async () => {
  const urls: string[] = []
  await getUser("7", async (url) => {
    urls.push(url)
    return { id: "7", name: "Bo" }
  })
  expect(urls).toEqual(["/api/users/7"])
})
