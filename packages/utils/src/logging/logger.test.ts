import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { createLogger } from "./logger"

const TEST_PREFIX = "omo-utils-logger"

describe("#given a bound utils logger", () => {
  let tempDir: string
  let logFilePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-`))
    logFilePath = path.join(tempDir, "product.log")
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test("#when flushed with product data #then it writes the historical timestamp message json line", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })

    logger.log("LOGGER-OK", { qa: true })
    logger._flushForTesting()

    expect(fs.readFileSync(logFilePath, "utf8")).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] LOGGER-OK \{"qa":true\}\n$/)
  })

  test("#when cyclic data cannot be serialized #then logging swallows the failure and writes no partial line", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(() => logger.log("CYCLIC", cyclic)).not.toThrow()
    logger._flushForTesting()

    expect(fs.existsSync(logFilePath)).toBe(false)
  })

  // Fork H40: tests that replaced the logger module with mock.module only saw the messages of modules loaded after the
  // mock; a test sink sees every call, whatever loaded first.
  test("#when a test sink is set #then every message goes to it and nothing to the file, until reset", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })
    const seen: Array<{ message: string; data?: unknown }> = []

    logger._setLoggerForTesting({ sink: (message, data) => void seen.push({ message, data }) })
    logger.log("TO-SINK", { n: 1 })
    logger._flushForTesting()
    logger._resetLoggerForTesting()
    logger.log("TO-FILE")
    logger._flushForTesting()

    expect(seen).toEqual([{ message: "TO-SINK", data: { n: 1 } }])
    expect(fs.readFileSync(logFilePath, "utf8")).toContain("TO-FILE")
    expect(fs.readFileSync(logFilePath, "utf8")).not.toContain("TO-SINK")
  })

  test("#when reset follows a test override #then the default resolved path is restored", () => {
    const defaultLogFilePath = path.join(tempDir, "default.log")
    const overrideLogFilePath = path.join(tempDir, "override.log")
    const logger = createLogger({ logFileName: "default.log", resolveLogFilePath: () => defaultLogFilePath })

    logger._setLoggerForTesting({ filePath: overrideLogFilePath, maxSizeBytes: 1, maxBackups: 1 })
    logger._resetLoggerForTesting()

    expect(logger.getLogFilePath()).toBe(defaultLogFilePath)
  })
})
