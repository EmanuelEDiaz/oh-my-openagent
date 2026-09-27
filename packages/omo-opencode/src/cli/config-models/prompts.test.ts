/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as p from "@clack/prompts"

import { promptOrder } from "./prompts"

describe("promptOrder", () => {
  afterEach(() => {
    mock.restore()
  })

  test("asks for the primary, then each fallback, pre-selecting the previous order", async () => {
    // given
    const initialValues: unknown[] = []
    spyOn(p, "select")
      .mockImplementationOnce(async (options) => {
        initialValues.push(options.initialValue)
        return "c"
      })
      .mockImplementationOnce(async (options) => {
        initialValues.push(options.initialValue)
        return "a"
      })

    // when
    const ordered = await promptOrder({ selected: ["a", "b", "c"], preferred: ["b", "a"] })

    // then
    expect(ordered).toEqual(["c", "a", "b"])
    expect(initialValues).toEqual(["b", "b"])
  })

  test("skips prompting when a single model is selected", async () => {
    // given
    const selectSpy = spyOn(p, "select")

    // when
    const ordered = await promptOrder({ selected: ["a"], preferred: [] })

    // then
    expect(ordered).toEqual(["a"])
    expect(selectSpy).not.toHaveBeenCalled()
  })
})
