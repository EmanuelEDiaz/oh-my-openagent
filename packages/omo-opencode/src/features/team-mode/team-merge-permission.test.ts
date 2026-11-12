import { afterEach, describe, expect, it, mock, test } from "bun:test"

import { applyTeamMergeCommand, leadMergesToBranch, resetTeamMergePermissionForTesting, seedTeamMergePermission, teamMergeChoiceFromPrompt } from "./team-merge-permission"

describe("/omo-team-merge: the user's one-time permission (fork roadmap 0.28)", () => {
  afterEach(() => resetTeamMergePermissionForTesting())

  test("`on` saves the permission in the user's config and applies it at once", () => {
    // given
    const update = mock(() => ({}))
    seedTeamMergePermission(false)

    // when
    const result = applyTeamMergeCommand("on", update)

    // then
    expect(update).toHaveBeenCalledWith({ scope: "user", edits: [{ path: ["[opencode]", "team_mode", "lead_merges_to_branch"], value: true }] })
    expect(leadMergesToBranch()).toBe(true)
    expect(result.ok).toBe(true)
  })

  test("`off` withdraws it", () => {
    // given
    const update = mock(() => ({}))
    seedTeamMergePermission(true)

    // when
    applyTeamMergeCommand("off", update)

    // then
    expect(update).toHaveBeenCalledWith({ scope: "user", edits: [{ path: ["[opencode]", "team_mode", "lead_merges_to_branch"], value: false }] })
    expect(leadMergesToBranch()).toBe(false)
  })

  test("anything else changes nothing", () => {
    // given
    const update = mock(() => ({}))
    seedTeamMergePermission(false)

    // when
    const result = applyTeamMergeCommand("please", update)

    // then
    expect(update).not.toHaveBeenCalled()
    expect(leadMergesToBranch()).toBe(false)
    expect(result.ok).toBe(false)
  })

  test("a failed write leaves the permission as it was", () => {
    // given
    seedTeamMergePermission(false)

    // when
    const result = applyTeamMergeCommand("on", () => { throw new Error("read-only") })

    // then
    expect(leadMergesToBranch()).toBe(false)
    expect(result.ok).toBe(false)
  })
})

describe("teamMergeChoiceFromPrompt: only the user's own command message carries the choice", () => {
  it.each([
    ["the expanded command", "<omo-team-merge>on</omo-team-merge>\n<command-instruction>...</command-instruction>", "on"],
    ["the raw command", "/omo-team-merge off", "off"],
    ["an unknown argument", "<omo-team-merge>maybe</omo-team-merge>", "invalid"],
    ["an ordinary message mentioning it", "¿qué hace /omo-team-merge? explícamelo", undefined],
    ["no command", "une la rama team/utils a master", undefined],
  ] as const)("%s", (_name, text, expected) => {
    expect(teamMergeChoiceFromPrompt(text)).toBe(expected)
  })
})
