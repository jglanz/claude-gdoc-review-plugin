import { mkdtemp, rm } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import {
  ApproveAutoMode,
  createPluginConfigDefaultOptions,
  GDocReview,
  isNonEmptyString,
  LogEntry,
  Logger,
  LogLevel,
  PluginConfig,
  readTextFileOrNull,
  resolvePluginConfig,
  PermissionMode,
  resolveApproveAutoPermissionMode,
  resolveStateDirectory,
  setActiveStateDirectory,
  SyncMode,
  writeFileAtomic
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

describe("PluginConfig", () => {
  const originalEnvironment = { ...process.env }

  let configDirectoryPath: string = null

  async function writeConfigFile(content: string): Promise<void> {
    await writeFileAtomic(
      path.join(resolveStateDirectory(), PluginConfig.ConfigFileName),
      content
    )
  }

  /** The `warn` lines the degradation path wrote to this run's own log. */
  async function readWarnings(): Promise<string[]> {
    const text = await readTextFileOrNull(
      path.join(resolveStateDirectory(), Logger.FileName)
    )

    return (text ?? "")
      .split(Logger.LineSeparator)
      .filter(isNonEmptyString)
      .map(line => JSON.parse(line) as LogEntry)
      .filter(entry => entry.level === LogLevel.warn)
      .map(entry => entry.message)
  }

  beforeEach(async () => {
    configDirectoryPath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("config-")
    )
    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] =
      configDirectoryPath
    ;[
      PluginConfig.ApproveModeEnvironmentKey,
      PluginConfig.SyncModeEnvironmentKey,
      PluginConfig.ReplyPrefixEnvironmentKey,
      PluginConfig.LogLevelEnvironmentKey
    ].forEach(key => delete process.env[key])
  })

  afterEach(async () => {
    process.env = { ...originalEnvironment }
    await rm(configDirectoryPath, { recursive: true, force: true })
  })

  describe("resolveStateDirectory", () => {
    it("joins the configured Claude directory with the plugin directory name", () => {
      expect(resolveStateDirectory()).toBe(
        path.join(configDirectoryPath, GDocReview.StateDirName)
      )
    })

    it("falls back to the home directory when the variable is unset or empty", () => {
      const expected = path.join(
        homedir(),
        PluginConfig.ClaudeConfigDirectoryName,
        GDocReview.StateDirName
      )

      delete process.env[PluginConfig.ConfigDirectoryEnvironmentKey]
      expect(resolveStateDirectory()).toBe(expected)

      process.env[PluginConfig.ConfigDirectoryEnvironmentKey] = ""
      expect(resolveStateDirectory()).toBe(expected)
    })
  })

  describe("createPluginConfigDefaultOptions", () => {
    it("names every default from a constant", () => {
      expect(createPluginConfigDefaultOptions()).toEqual({
        approveAutoMode: ApproveAutoMode.acceptEdits,
        syncMode: SyncMode.content,
        replyPrefix: GDocReview.ReplyPrefix,
        logLevel: LogLevel.info
      })
    })
  })

  describe("resolvePluginConfig", () => {
    it("uses the defaults when no config file exists", async () => {
      await expect(resolvePluginConfig()).resolves.toEqual(
        createPluginConfigDefaultOptions()
      )
    })

    it("reads the config file", async () => {
      await writeConfigFile(
        JSON.stringify({
          approveAutoMode: ApproveAutoMode.auto,
          syncMode: SyncMode.file_path
        })
      )

      const config = await resolvePluginConfig()

      expect(config.approveAutoMode).toBe(ApproveAutoMode.auto)
      expect(config.syncMode).toBe(SyncMode.file_path)
      expect(config.replyPrefix).toBe(GDocReview.ReplyPrefix)
    })

    it("lets the environment override the config file", async () => {
      await writeConfigFile(
        JSON.stringify({ approveAutoMode: ApproveAutoMode.auto })
      )
      process.env[PluginConfig.ApproveModeEnvironmentKey] =
        ApproveAutoMode.acceptEdits
      process.env[PluginConfig.ReplyPrefixEnvironmentKey] = "[agent]"
      process.env[PluginConfig.LogLevelEnvironmentKey] = LogLevel.debug

      const config = await resolvePluginConfig()

      expect(config.approveAutoMode).toBe(ApproveAutoMode.acceptEdits)
      expect(config.replyPrefix).toBe("[agent]")
      expect(config.logLevel).toBe(LogLevel.debug)
    })

    it("lets the caller override the environment", async () => {
      process.env[PluginConfig.SyncModeEnvironmentKey] = SyncMode.file_path

      const config = await resolvePluginConfig({ syncMode: SyncMode.content })

      expect(config.syncMode).toBe(SyncMode.content)
    })

    it("degrades to the defaults for a config file that is not JSON", async () => {
      await writeConfigFile("{ not json")

      await expect(resolvePluginConfig()).resolves.toEqual(
        createPluginConfigDefaultOptions()
      )
    })

    it("degrades to the defaults for a config file with an unknown enum value", async () => {
      await writeConfigFile(JSON.stringify({ syncMode: "telepathy" }))

      await expect(resolvePluginConfig()).resolves.toEqual(
        createPluginConfigDefaultOptions()
      )
    })

    it("degrades to the defaults for an unusable environment override", async () => {
      process.env[PluginConfig.ApproveModeEnvironmentKey] = "yolo"

      await expect(resolvePluginConfig()).resolves.toEqual(
        createPluginConfigDefaultOptions()
      )
    })

    it("keeps the valid environment keys when another one is unusable", async () => {
      process.env[PluginConfig.SyncModeEnvironmentKey] = "telepathy"
      process.env[PluginConfig.LogLevelEnvironmentKey] = LogLevel.debug
      process.env[PluginConfig.ReplyPrefixEnvironmentKey] = "[agent]"

      const config = await resolvePluginConfig()

      // One bogus variable used to discard the whole environment layer, and the
      // log level is exactly what an operator sets to find out why.
      expect(config.logLevel).toBe(LogLevel.debug)
      expect(config.replyPrefix).toBe("[agent]")
      expect(config.syncMode).toBe(PluginConfig.DefaultSyncMode)
    })

    it("warns per rejected variable, naming it", async () => {
      process.env[PluginConfig.SyncModeEnvironmentKey] = "telepathy"

      await resolvePluginConfig()

      const warnings = await readWarnings()

      expect(
        warnings.some(
          message =>
            message.includes(PluginConfig.DegradedConfigMessage) &&
            message.includes(
              PluginConfig.newEnvironmentSourceName(
                PluginConfig.SyncModeEnvironmentKey
              )
            )
        )
      ).toBe(true)
      expect(
        warnings.some(message =>
          message.includes(PluginConfig.LogLevelEnvironmentKey)
        )
      ).toBe(false)
    })

    it("warns naming the config file it ignored", async () => {
      await writeConfigFile("{ not json")
      await resolvePluginConfig()

      const warnings = await readWarnings()

      expect(
        warnings.some(
          message =>
            message.includes(PluginConfig.DegradedConfigMessage) &&
            message.includes(PluginConfig.ConfigFileName)
        )
      ).toBe(true)
    })

    it("names an environment variable for every configuration key", () => {
      expect(
        Object.keys(PluginConfig.EnvironmentVariableByOption).sort()
      ).toEqual(Object.keys(createPluginConfigDefaultOptions()).sort())
    })

    it("reads config.json from the state directory the caller names", async () => {
      const otherStatePath = await mkdtemp(
        TestEnvironment.newTemporaryDirectoryTemplate("config-other-")
      )

      await writeFileAtomic(
        path.join(otherStatePath, PluginConfig.ConfigFileName),
        JSON.stringify({ syncMode: SyncMode.file_path })
      )

      await expect(
        resolvePluginConfig({ stateDirectory: otherStatePath })
      ).resolves.toMatchObject({ syncMode: SyncMode.file_path })
      await rm(otherStatePath, { recursive: true, force: true })
    })
  })
})

describe("resolveApproveAutoPermissionMode", () => {
  it("maps each configured value onto the mode that row requests", () => {
    expect(resolveApproveAutoPermissionMode(ApproveAutoMode.acceptEdits)).toBe(
      PermissionMode.acceptEdits
    )
    expect(resolveApproveAutoPermissionMode(ApproveAutoMode.auto)).toBe(
      PermissionMode.auto
    )
  })

  it("falls back to the narrower mode for an unconfigured value", () => {
    expect(resolveApproveAutoPermissionMode(null)).toBe(
      PermissionMode.acceptEdits
    )
  })
})

describe("setActiveStateDirectory", () => {
  const originalEnvironment = { ...process.env }

  afterEach(() => {
    setActiveStateDirectory(null)
    process.env = { ...originalEnvironment }
  })

  it("makes the late-bound resolution name the invocation's own directory", () => {
    setActiveStateDirectory("/elsewhere/gdoc-review")

    expect(resolveStateDirectory()).toBe("/elsewhere/gdoc-review")
  })

  it("falls back to the environment once it is cleared", () => {
    const fromEnvironment = resolveStateDirectory()

    setActiveStateDirectory("/elsewhere/gdoc-review")
    setActiveStateDirectory("")

    expect(resolveStateDirectory()).toBe(fromEnvironment)
  })
})
