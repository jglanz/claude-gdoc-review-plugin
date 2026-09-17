import { createLogThreadCommand } from "claude-gdoc-review-plugin"

import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli,
  runCliSetup
} from "../../support/cliTestSupport.js"

describe("createLogThreadCommand", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
    await runCliSetup(environment)
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("is registered under the log-thread subcommand name", () => {
    expect(createLogThreadCommand().command).toBe("log-thread")
  })

  it("records the revision-log comment id", async () => {
    const result = await runCli(environment, [
      "log-thread",
      "--plan",
      environment.planFile,
      "--comment-id",
      "comment-log-1"
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).logCommentId).toBe("comment-log-1")
    expect(
      (await environment.store.load(environment.planSlug)).logCommentId
    ).toBe("comment-log-1")
  })

  it("replaces a previously recorded comment id", async () => {
    await runCli(environment, [
      "log-thread",
      "--plan",
      environment.planFile,
      "--comment-id",
      "comment-log-1"
    ])
    await runCli(environment, [
      "log-thread",
      "--plan",
      environment.planFile,
      "--comment-id",
      "comment-log-2"
    ])

    expect(
      (await environment.store.load(environment.planSlug)).logCommentId
    ).toBe("comment-log-2")
  })

  it("fails without a comment id", async () => {
    const result = await runCli(environment, [
      "log-thread",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(
      (await environment.store.load(environment.planSlug)).logCommentId
    ).toBeNull()
  })
})
