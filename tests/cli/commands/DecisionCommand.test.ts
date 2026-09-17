import { rm } from "node:fs/promises"

import {
  createDecisionCommand,
  DecisionCommand,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewMenuLabel
} from "claude-gdoc-review-plugin"

import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli,
  runCliSetup,
  writeCliPlanText
} from "../../support/cliTestSupport.js"

describe("createDecisionCommand", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
    await runCliSetup(environment)
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("is registered under the decision subcommand name", () => {
    expect(createDecisionCommand().command).toBe("decision")
  })

  it("labels every choice the way the menu does", () => {
    expect(
      DecisionCommand.labelFor(ReviewDecisionChoice.approve_auto, null)
    ).toBe(`${ReviewMenuLabel.approveAuto}`)
    expect(
      DecisionCommand.labelFor(ReviewDecisionChoice.approve_manual, null)
    ).toBe(`${ReviewMenuLabel.approveManual}`)
    expect(DecisionCommand.labelFor(ReviewDecisionChoice.check_doc, null)).toBe(
      `${ReviewMenuLabel.checkDoc}`
    )
    expect(DecisionCommand.labelFor(ReviewDecisionChoice.other, null)).toBe(
      `${ReviewMenuLabel.somethingElse}`
    )
    expect(
      DecisionCommand.labelFor(ReviewDecisionChoice.other, "add a rollback")
    ).toBe("add a rollback")
  })

  it("pins an approval to the digest of the current plan text", async () => {
    const planSha256 = await writeCliPlanText(
        environment,
        "# CLI plan\n\nSecond revision.\n"
      ),
      result = await runCli(environment, [
        "decision",
        "--plan",
        environment.planFile,
        "--choice",
        ReviewDecisionChoice.approve_auto
      ])

    expect(result.exitCode).toBe(0)

    const { decision } = await environment.store.load(environment.planSlug)
    expect(decision.choice).toBe(ReviewDecisionChoice.approve_auto)
    expect(decision.label).toBe(`${ReviewMenuLabel.approveAuto}`)
    expect(decision.text).toBeNull()
    expect(decision.planSha256).toBe(planSha256)
    expect(Date.parse(decision.at)).not.toBeNaN()
    expect(decision.source).toBe(ReviewDecisionSource.cli)
    expect(decision.toolUseId).toBeNull()
    expect(decision.consumedAt).toBeNull()
  })

  it("stores the free text of an 'other' answer", async () => {
    await runCli(environment, [
      "decision",
      "--plan",
      environment.planFile,
      "--choice",
      ReviewDecisionChoice.other,
      "--text",
      "Add a rollback section before we approve"
    ])

    const { decision } = await environment.store.load(environment.planSlug)
    expect(decision.choice).toBe(ReviewDecisionChoice.other)
    expect(decision.text).toBe("Add a rollback section before we approve")
    expect(decision.label).toBe("Add a rollback section before we approve")
  })

  it("rejects a choice that is not on the menu", async () => {
    const result = await runCli(environment, [
      "decision",
      "--plan",
      environment.planFile,
      "--choice",
      "approve_everything"
    ])

    expect(result.exitCode).toBe(1)
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("fails when the plan file has no text to pin the decision to", async () => {
    await rm(environment.planFile)

    const result = await runCli(environment, [
      "decision",
      "--plan",
      environment.planFile,
      "--choice",
      ReviewDecisionChoice.approve_manual
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(
      DecisionCommand.newMissingPlanTextMessage(environment.planFile)
    )
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })
})
