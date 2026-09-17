import { rm } from "node:fs/promises"

import { createSyncedCommand, SyncedCommand } from "claude-gdoc-review-plugin"

import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli,
  runCliSetup,
  writeCliPlanText
} from "../../support/cliTestSupport.js"

describe("createSyncedCommand", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
    await runCliSetup(environment)
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("is registered under the synced subcommand name", () => {
    expect(createSyncedCommand().command).toBe("synced")
  })

  it("records the plan digest against the next revision", async () => {
    const planSha256 = await writeCliPlanText(
        environment,
        "# CLI plan\n\nSynced revision.\n"
      ),
      result = await runCli(environment, [
        "synced",
        "--plan",
        environment.planFile
      ])

    expect(result.exitCode).toBe(0)

    const state = await environment.store.load(environment.planSlug)
    expect(state.revision).toBe(1)
    expect(state.lastSync).toEqual({
      at: expect.any(String),
      planSha256,
      revision: 1
    })
  })

  it("bumps the revision on every call", async () => {
    await runCli(environment, ["synced", "--plan", environment.planFile])
    await runCli(environment, ["synced", "--plan", environment.planFile])

    const state = await environment.store.load(environment.planSlug)
    expect(state.revision).toBe(2)
    expect(state.lastSync.revision).toBe(2)
  })

  it("fails when the plan file does not exist", async () => {
    await rm(environment.planFile)

    const result = await runCli(environment, [
      "synced",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(
      SyncedCommand.newMissingPlanTextMessage(environment.planFile)
    )
    expect(
      (await environment.store.load(environment.planSlug)).lastSync
    ).toBeNull()
  })
})
