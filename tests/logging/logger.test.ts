import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  FsUtils,
  getLogger,
  LogEntry,
  Logger,
  LogLevel,
  PluginConfig,
  GDocReview
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

async function readLogEntries(
  configDirectoryPath: string
): Promise<LogEntry[]> {
  const logFile = path.join(
      configDirectoryPath,
      GDocReview.StateDirName,
      Logger.FileName
    ),
    text = await readFile(logFile, "utf8")

  return text
    .split(Logger.LineSeparator)
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as LogEntry)
}

async function writeConfigText(
  configDirectoryPath: string,
  text: string
): Promise<void> {
  const statePath = path.join(configDirectoryPath, GDocReview.StateDirName)

  await mkdir(statePath, { recursive: true })
  await writeFile(
    path.join(statePath, PluginConfig.ConfigFileName),
    text,
    "utf8"
  )
}

async function writeConfigFile(
  configDirectoryPath: string,
  config: Record<string, unknown>
): Promise<void> {
  await writeConfigText(configDirectoryPath, JSON.stringify(config))
}

const ModeMask = 0o777,
  WindowsPlatform = "win32"

describe("logger", () => {
  const originalEnvironment = { ...process.env }

  let configDirectoryPath: string = null,
    stdoutSpy: jest.SpyInstance = null,
    stderrSpy: jest.SpyInstance = null

  beforeEach(async () => {
    configDirectoryPath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("log-")
    )
    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] =
      configDirectoryPath
    delete process.env[PluginConfig.LogLevelEnvironmentKey]

    stdoutSpy = jest.spyOn(process.stdout, "write").mockReturnValue(true)
    stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true)
  })

  afterEach(async () => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    process.env = { ...originalEnvironment }
    await rm(configDirectoryPath, { recursive: true, force: true })
  })

  it("demands the source filename", () => {
    expect(() => getLogger("")).toThrow()
  })

  it("appends one JSON line per call, categorized by file, and writes no stream", async () => {
    const log = getLogger("/plugin/src/state/ReviewStateStore.ts")
    log.info("synced revision %d for %s", 3, "my-plan")
    log.error("sync failed")

    const entries = await readLogEntries(configDirectoryPath)

    expect(entries).toHaveLength(2)
    expect(entries[0].category).toBe("ReviewStateStore.ts")
    expect(entries[0].level).toBe(LogLevel.info)
    expect(entries[0].message).toBe("synced revision 3 for my-plan")
    expect(Date.parse(entries[0].at)).not.toBeNaN()
    expect(entries[1].level).toBe(LogLevel.error)
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it("creates the state directory on demand, owner-only", async () => {
    const log = getLogger("/plugin/src/plan/PlanDigest.ts")
    log.warn("nothing to hash")

    await expect(readLogEntries(configDirectoryPath)).resolves.toHaveLength(1)

    if (process.platform !== WindowsPlatform) {
      const stateDirectoryPath = path.join(
        configDirectoryPath,
        GDocReview.StateDirName
      )

      expect((await stat(stateDirectoryPath)).mode & ModeMask).toBe(
        FsUtils.DirectoryMode
      )
    }
  })

  it("creates the log file owner-only", async () => {
    const log = getLogger("/plugin/src/plan/PlanDigest.ts")
    log.warn("nothing to hash")

    const logFile = path.join(
      configDirectoryPath,
      GDocReview.StateDirName,
      Logger.FileName
    )

    if (process.platform !== WindowsPlatform) {
      expect((await stat(logFile)).mode & ModeMask).toBe(Logger.FileMode)
    }
  })

  it("drops calls below the level selected by the environment", async () => {
    process.env[PluginConfig.LogLevelEnvironmentKey] = LogLevel.warn

    const log = getLogger("/plugin/src/config/PluginConfig.ts")
    log.debug("invisible")
    log.info("also invisible")
    log.warn("visible")

    const entries = await readLogEntries(configDirectoryPath)

    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe(LogLevel.warn)
  })

  it("drops calls below the level config.json names", async () => {
    await writeConfigFile(configDirectoryPath, { logLevel: LogLevel.error })

    const log = getLogger("/plugin/src/hooks/HookDispatcher.ts")
    log.debug("invisible")
    log.warn("also invisible")
    log.error("visible")

    const entries = await readLogEntries(configDirectoryPath)

    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe(LogLevel.error)
  })

  it("lets the environment override the level config.json names", async () => {
    await writeConfigFile(configDirectoryPath, { logLevel: LogLevel.error })
    process.env[PluginConfig.LogLevelEnvironmentKey] = LogLevel.debug

    const log = getLogger("/plugin/src/hooks/HookDispatcher.ts")
    log.debug("visible after all")

    await expect(readLogEntries(configDirectoryPath)).resolves.toHaveLength(1)
  })

  it("keeps the default for a malformed or unusable config.json", async () => {
    await writeConfigText(configDirectoryPath, "{ not json at all")

    const malformed = getLogger("/plugin/src/hooks/HookDispatcher.ts")
    malformed.info("recorded")
    malformed.debug("below the default level")

    await expect(readLogEntries(configDirectoryPath)).resolves.toHaveLength(1)

    const otherDirectoryPath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("log-")
    )

    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] = otherDirectoryPath
    await writeConfigFile(otherDirectoryPath, { logLevel: "shout" })

    const unusable = getLogger("/plugin/src/hooks/HookDispatcher.ts")
    unusable.info("recorded")

    await expect(readLogEntries(otherDirectoryPath)).resolves.toHaveLength(1)
    await rm(otherDirectoryPath, { recursive: true, force: true })
  })

  it("writes into the state directory the caller names", async () => {
    const otherStatePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("log-state-")
    )

    getLogger("/plugin/src/cli/index.ts", {
      stateDirectory: otherStatePath
    }).info("into the named directory")

    const text = await readFile(
      path.join(otherStatePath, Logger.FileName),
      "utf8"
    )

    expect(text).toContain("into the named directory")
    await expect(readLogEntries(configDirectoryPath)).rejects.toThrow()
    await rm(otherStatePath, { recursive: true, force: true })
  })

  it("returns one logger per category and state directory", async () => {
    const otherStatePath = await mkdtemp(
        TestEnvironment.newTemporaryDirectoryTemplate("log-state-")
      ),
      first = getLogger("/plugin/src/state/ReviewStateStore.ts"),
      again = getLogger("/plugin/src/state/ReviewStateStore.ts"),
      otherCategory = getLogger("/plugin/src/plan/PlanDigest.ts"),
      otherDirectory = getLogger("/plugin/src/state/ReviewStateStore.ts", {
        stateDirectory: otherStatePath
      })

    expect(again).toBe(first)
    expect(otherCategory).not.toBe(first)
    expect(otherDirectory).not.toBe(first)

    await rm(otherStatePath, { recursive: true, force: true })
  })

  it("ignores an unusable level and keeps the default", async () => {
    process.env[PluginConfig.LogLevelEnvironmentKey] = "shout"

    const log = getLogger("/plugin/src/logging/logger.ts")
    log.info("still recorded")

    await expect(readLogEntries(configDirectoryPath)).resolves.toHaveLength(1)
  })
})

describe("Logger.newLogFile", () => {
  it("resolves the diagnostic log of a state directory", () => {
    expect(Logger.newLogFile("/state/gdoc-review")).toBe(
      path.join("/state/gdoc-review", Logger.FileName)
    )
  })

  it("is the one spelling both fail-closed messages use", () => {
    // The gate's deny and the deny built at the process boundary must name the
    // same file, or the operator is told to read a log nothing wrote.
    expect(path.basename(Logger.newLogFile("/anywhere"))).toBe(Logger.FileName)
  })
})
