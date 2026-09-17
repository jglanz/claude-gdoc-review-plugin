import { createCancelCommand, ReviewStatus } from "claude-gdoc-review-plugin"

import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  CliDocId,
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli,
  runCliSetup
} from "../../support/cliTestSupport.js"

describe("createCancelCommand", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("is registered under the cancel subcommand name", () => {
    expect(createCancelCommand().command).toBe("cancel")
  })

  it("cancels the review while keeping the Doc registration", async () => {
    await runCliSetup(environment)

    const result = await runCli(environment, [
      "cancel",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(0)

    const state = await environment.store.load(environment.planSlug)
    expect(state.status).toBe(ReviewStatus.cancelled)
    expect(state.doc.id).toBe(CliDocId)
    expect(JSON.parse(result.stdout).status).toBe(ReviewStatus.cancelled)
  })

  it("fails when no review exists for the plan", async () => {
    const result = await runCli(environment, [
      "cancel",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
  })
})
