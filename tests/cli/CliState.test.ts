import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  appendCliState,
  CliState,
  cliState,
  createCliHookContextOptions,
  createCliStore,
  createCliStoreOptions,
  PluginConfig,
  resetCliState,
  resolveCliStateDirectory,
  ReviewStateStore
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

const EmptyArguments = { _: [], $0: "gdoc-review" }

describe("appendCliState", () => {
  afterEach(() => {
    resetCliState()
  })

  it("makes a relative --state-dir absolute", () => {
    appendCliState({ ...EmptyArguments, "state-dir": "state" })

    expect(cliState.stateDirectory).toBe(path.resolve("state"))
  })

  it("keeps an absolute --state-dir", () => {
    const absolute = path.join(tmpdir(), "gdoc-review-absolute")
    appendCliState({ ...EmptyArguments, "state-dir": absolute })

    expect(cliState.stateDirectory).toBe(absolute)
  })

  it("clears the override when the option is absent or empty", () => {
    appendCliState({ ...EmptyArguments, "state-dir": "state" })
    appendCliState({ ...EmptyArguments, "state-dir": "" })
    expect(cliState.stateDirectory).toBeNull()

    appendCliState({ ...EmptyArguments, "state-dir": "state" })
    appendCliState(EmptyArguments)
    expect(cliState.stateDirectory).toBeNull()
  })

  it("names the option the parser registers", () => {
    expect(CliState.StateDirectoryOption).toBe("state-dir")
    expect(CliState.StateDirectoryOptionDefinition.type).toBe("string")
  })
})

describe("resetCliState", () => {
  it("returns the state to its pre-parse values", () => {
    appendCliState({ ...EmptyArguments, "state-dir": "state" })
    resetCliState()

    expect(cliState.stateDirectory).toBeNull()
  })
})

describe("resolveCliStateDirectory", () => {
  const previousConfigDirectory =
    process.env[PluginConfig.ConfigDirectoryEnvironmentKey]

  afterEach(() => {
    resetCliState()
    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] =
      previousConfigDirectory
  })

  it("prefers the --state-dir override", () => {
    const absolute = path.join(tmpdir(), "gdoc-review-override")
    appendCliState({ ...EmptyArguments, "state-dir": absolute })

    expect(resolveCliStateDirectory()).toBe(absolute)
    expect(createCliStoreOptions()).toEqual({ stateDirectory: absolute })
    expect(createCliHookContextOptions()).toEqual({
      stateDirectory: absolute
    })
  })

  it("falls back to the environment when no override was given", () => {
    const configDirectory = path.join(tmpdir(), "gdoc-review-config")
    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] = configDirectory

    expect(resolveCliStateDirectory()).toBe(
      path.join(configDirectory, "gdoc-review")
    )
    expect(createCliStoreOptions()).toEqual({})
    expect(createCliHookContextOptions()).toEqual({})
  })
})

describe("createCliStore", () => {
  let statePath: string = null

  beforeEach(async () => {
    statePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("cli-state-")
    )
  })

  afterEach(async () => {
    resetCliState()
    await rm(statePath, { recursive: true, force: true })
  })

  it("opens the store in the overridden state directory", async () => {
    appendCliState({ ...EmptyArguments, "state-dir": statePath })

    const store = await createCliStore()
    expect(store).toBeInstanceOf(ReviewStateStore)
    expect(store.config.stateDirectory).toBe(statePath)
    expect(await store.listActive()).toEqual([])
  })
})
