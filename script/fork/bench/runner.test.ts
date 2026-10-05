import { describe, expect, test } from "bun:test"

import { NO_USER_ANSWER, answerQuestions } from "./runner"

describe("answerQuestions", () => {
  test("replies to every pending question with one answer per sub-question", async () => {
    const replies: unknown[] = []
    const client = {
      question: {
        list: async () => ({ data: [{ id: "q1", questions: [{}, {}] }, { id: "q2" }] }),
        reply: async (input: unknown) => {
          replies.push(input)
          return {}
        },
      },
    }
    await answerQuestions(client as never)
    expect(replies).toEqual([
      { requestID: "q1", answers: [[NO_USER_ANSWER], [NO_USER_ANSWER]] },
      { requestID: "q2", answers: [[NO_USER_ANSWER]] },
    ])
  })

  test("a failing list never breaks the run", async () => {
    const client = { question: { list: async () => Promise.reject(new Error("down")), reply: async () => ({}) } }
    await expect(answerQuestions(client as never)).resolves.toBeUndefined()
  })
})
