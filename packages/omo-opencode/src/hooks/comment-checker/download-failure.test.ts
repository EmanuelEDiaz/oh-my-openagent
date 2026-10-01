/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearDownloadFailure, readDownloadFailure, recordDownloadFailure } from "./download-failure"

describe("comment-checker download failure marker (fork 0.6)", () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  test("records, reads and clears the last failure", () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), "omo-cc-"))
    dirs.push(dir)

    // when
    recordDownloadFailure(join(dir, "bin"), new Error("getaddrinfo ENOTFOUND github.com"), new Date("2026-10-01T10:00:00Z"))

    // then
    expect(readDownloadFailure(join(dir, "bin"))).toEqual({ error: "getaddrinfo ENOTFOUND github.com", at: "2026-10-01T10:00:00.000Z" })
    clearDownloadFailure(join(dir, "bin"))
    expect(readDownloadFailure(join(dir, "bin"))).toBeNull()
  })

  test("no marker means never failed", () => {
    expect(readDownloadFailure(join(tmpdir(), "omo-cc-missing-dir"))).toBeNull()
  })
})
