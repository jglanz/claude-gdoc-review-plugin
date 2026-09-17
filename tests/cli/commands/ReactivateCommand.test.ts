import {
  createReactivateCommand,
  ReviewDecisionChoice,
  ReviewStatus
} from "claude-gdoc-review-plugin"

import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli,
  runCliSetup
} from "../../support/cliTestSupport.js"

describe("createReactivateCommand", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("is registered under the reactivate subcommand name", () => {
    expect(createReactivateCommand().command).toBe("reactivate")
  })

  it("reactivates a cancelled review and drops the stale decision", async () => {
    await runCliSetup(environment)
    await runCli(environment, [
      "decision",
      "--plan",
      environment.planFile,
      "--choice",
      ReviewDecisionChoice.approve_auto
    ])
    await runCli(environment, ["cancel", "--plan", environment.planFile])

    const result = await runCli(environment, [
      "reactivate",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(0)

    const state = await environment.store.load(environment.planSlug)
    expect(state.status).toBe(ReviewStatus.active)
    expect(state.decision).toBeNull()
    expect(state.approvedAt).toBeNull()
    expect(state.approvedMode).toBeNull()
  })

  it("keeps the recorded sync so only the approval has to be redone", async () => {
    await runCliSetup(environment)
    await runCli(environment, ["synced", "--plan", environment.planFile])
    await runCli(environment, ["reactivate", "--plan", environment.planFile])

    const state = await environment.store.load(environment.planSlug)
    expect(state.lastSync.revision).toBe(1)
  })

  it("fails when no review exists for the plan", async () => {
    const result = await runCli(environment, [
      "reactivate",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
  })
})
