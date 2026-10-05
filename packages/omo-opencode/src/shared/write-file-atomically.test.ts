import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync, readdirSync, renameSync, utimesSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { cleanStaleAtomicTempFiles, writeFileAtomically } from "./write-file-atomically"

const testDir = join(tmpdir(), "write-file-atomically-test-" + Date.now())

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe("writeFileAtomically", () => {
  it("writes content to a new file", () => {
    // given
    const filePath = join(testDir, "new-file.txt")
    const content = "hello world"

    // when
    writeFileAtomically(filePath, content)

    // then
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, "utf-8")).toBe(content)
  })

  it("#given target file exists #when writeFileAtomically called #then overwrites successfully", () => {
    // given
    const filePath = join(testDir, "existing-file.txt")
    const originalContent = "original content"
    const newContent = "new content"
    writeFileSync(filePath, originalContent, "utf-8")

    // when
    writeFileAtomically(filePath, newContent)

    // then
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, "utf-8")).toBe(newContent)
    expect(existsSync(`${filePath}.tmp`)).toBe(false)
  })

  it("#given private mode #when writeFileAtomically called #then temp and final files use that mode", () => {
    // given
    const filePath = join(testDir, "private-file.txt")
    const tempModes: number[] = []

    // when
    writeFileAtomically(filePath, "private", {
      mode: 0o600,
      beforeRenameSync: (tempPath) => {
        tempModes.push(statSync(tempPath).mode & 0o777)
      },
    })

    // then
    expect(readFileSync(filePath, "utf-8")).toBe("private")
    if (process.platform === "win32") {
      expect(tempModes).toHaveLength(1)
      return
    }
    expect(tempModes).toEqual([0o600])
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
  })

  it("#given parent directory does not exist #when writeFileAtomically called #then throws", () => {
    // given
    const filePath = join(testDir, "nonexistent", "deep", "file.txt")

    // when/then
    expect(() => writeFileAtomically(filePath, "content")).toThrow()
  })

  it("#given fsync fails with EPERM (synced folder) #when writeFileAtomically called #then write succeeds", () => {
    // given
    const filePath = join(testDir, "synced-folder.txt")
    const content = "content from a synced folder where fsync is rejected"

    // when
    writeFileAtomically(filePath, content, {
      fsyncSync: () => {
        const error = new Error("EPERM: operation not permitted, fsync") as NodeJS.ErrnoException
        error.code = "EPERM"
        throw error
      },
    })

    // then
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, "utf-8")).toBe(content)
  })

  it("#given fsync fails with EIO (real I/O error) #when writeFileAtomically called #then propagates the error", () => {
    // given
    const filePath = join(testDir, "io-error.txt")

    // when/then
    expect(() =>
      writeFileAtomically(filePath, "content", {
        fsyncSync: () => {
          const error = new Error("EIO: input/output error") as NodeJS.ErrnoException
          error.code = "EIO"
          throw error
        },
      }),
    ).toThrow("EIO")
  })

  it("#given two writers #when both write the same file #then temp names differ and no temp is left", () => {
    // given
    const filePath = join(testDir, "shared.json")
    const tempPaths: string[] = []

    // when
    writeFileAtomically(filePath, "first", {
      beforeRenameSync: (firstTemp) => {
        tempPaths.push(firstTemp)
        writeFileAtomically(filePath, "second", { beforeRenameSync: (secondTemp) => tempPaths.push(secondTemp) })
      },
    })

    // then
    expect(tempPaths).toHaveLength(2)
    expect(tempPaths[0]).not.toBe(tempPaths[1])
    expect(tempPaths[0]).toMatch(/\.tmp-\d+-[0-9a-f]+$/)
    expect(readFileSync(filePath, "utf-8")).toBe("first")
    expect(readdirSync(testDir)).toEqual(["shared.json"])
  })

  it("#given rename fails #when writeFileAtomically called #then the temp file is removed and the error propagates", () => {
    // given
    const filePath = join(testDir, "rename-fails.json")

    // when/then
    expect(() =>
      writeFileAtomically(filePath, "x", {
        renameSync: () => {
          throw Object.assign(new Error("EXDEV: cross-device"), { code: "EXDEV" })
        },
      }),
    ).toThrow("EXDEV")
    expect(readdirSync(testDir)).toEqual([])
  })

  it("#given Windows rename is busy twice #when writeFileAtomically called #then it retries and succeeds", () => {
    // given
    const filePath = join(testDir, "busy.json")
    writeFileSync(filePath, "old")
    let calls = 0

    // when
    writeFileAtomically(filePath, "new", {
      platform: "win32",
      renameSync: (from, to) => {
        calls++
        if (calls <= 2) throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" })
        renameSync(from, to)
      },
    })

    // then
    expect(calls).toBe(3)
    expect(readFileSync(filePath, "utf-8")).toBe("new")
  })
})

describe("cleanStaleAtomicTempFiles", () => {
  it("#given old and fresh temp files #when cleaned #then only the old ones go", () => {
    // given
    const old = join(testDir, "state.json.tmp-123-abcdef")
    const fresh = join(testDir, "state.json.tmp-456-012345")
    const keep = join(testDir, "state.json")
    for (const path of [old, fresh, keep]) writeFileSync(path, "x")
    const past = new Date(Date.now() - 20 * 60_000)
    utimesSync(old, past, past)
    utimesSync(keep, past, past)

    // when
    const removed = cleanStaleAtomicTempFiles(testDir)

    // then
    expect(removed).toBe(1)
    expect(readdirSync(testDir).sort()).toEqual(["state.json", "state.json.tmp-456-012345"])
  })

  it("#given legacy fixed-name temp files #when cleaned #then old ones go, fresh ones and other files stay", () => {
    // given
    const oldLegacy = join(testDir, "boulder.json.tmp")
    const freshLegacy = join(testDir, "ralph-loop.json.tmp")
    const plain = join(testDir, "notes.tmp")
    for (const path of [oldLegacy, freshLegacy, plain]) writeFileSync(path, "x")
    const past = new Date(Date.now() - 20 * 60_000)
    utimesSync(oldLegacy, past, past)
    utimesSync(plain, past, past)

    // when
    const removed = cleanStaleAtomicTempFiles(testDir)

    // then
    expect(removed).toBe(1)
    expect(readdirSync(testDir).sort()).toEqual(["notes.tmp", "ralph-loop.json.tmp"])
  })

  it("#given recursive option #when cleaned #then nested temp files go too; missing dir is harmless", () => {
    // given
    mkdirSync(join(testDir, "nested"))
    const nested = join(testDir, "nested", "a.json.tmp-1-ff")
    writeFileSync(nested, "x")

    // when
    const removed = cleanStaleAtomicTempFiles(testDir, { recursive: true, maxAgeMs: 0, now: Date.now() + 1000 })

    // then
    expect(removed).toBe(1)
    expect(existsSync(nested)).toBe(false)
    expect(cleanStaleAtomicTempFiles(join(testDir, "missing"))).toBe(0)
  })
})
