import { rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  locateReview,
  ReviewLookup,
  ReviewStateCodec,
  ReviewStatus,
  writeFileAtomic
} from "claude-gdoc-review-plugin"

import {
  createActiveReviewState,
  createHookInput,
  createHookTestEnvironment,
  destroyHookTestEnvironment,
  HookTestEnvironment,
  rememberSessionPlanFile,
  writePlanText
} from "../support/hookTestSupport.js"

describe("locateReview", () => {
  let environment: HookTestEnvironment = null

  beforeEach(async () => {
    environment = await createHookTestEnvironment()
    await writePlanText(environment, "# Plan\n")
  })

  afterEach(async () => {
    await destroyHookTestEnvironment(environment)
  })

  it("resolves the plan file from the transcript and loads its review", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = createHookInput(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      ),
      review = await locateReview(input, environment.context)

    expect(review.planFile).toBe(environment.planFile)
    expect(review.planSlug).toBe(environment.planSlug)
    expect(review.state.status).toBe(ReviewStatus.active)
  })

  it("falls back to the sessions map when the transcript is gone", async () => {
    await rememberSessionPlanFile(environment)
    await rm(environment.transcriptPath, { force: true })
    await environment.store.save(createActiveReviewState(environment))

    const input = createHookInput(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      ),
      review = await locateReview(input, environment.context)

    expect(review.planFile).toBe(environment.planFile)
  })

  it("ignores the review of a cached plan the transcript has replaced", async () => {
    const cachedPlanFile = path.join(
      environment.workspacePath,
      "cached-plan.md"
    )

    await writeFile(cachedPlanFile, "# Cached plan\n", "utf8")
    await environment.store.writeSessionPlanRecord(environment.sessionId, {
      planFile: cachedPlanFile,
      transcriptMtimeMs: 1,
      transcriptSize: 1
    })
    await environment.store.save({
      ...createActiveReviewState(environment),
      planFile: cachedPlanFile
    })

    const input = createHookInput(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      ),
      review = await locateReview(input, environment.context)

    expect(review.planFile).toBe(environment.planFile)
    expect(review.planSlug).toBe(environment.planSlug)
    expect(review.state).toBeNull()
  })

  it("reports a located plan that has no review", async () => {
    const input = createHookInput(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      ),
      review = await locateReview(input, environment.context)

    expect(review.planSlug).toBe(environment.planSlug)
    expect(review.state).toBeNull()
  })

  it("fails the lookup for a review document naming a different plan file", async () => {
    const foreign = createActiveReviewState(environment),
      foreignPlanFile = "/tmp/plans/someone-elses-plan.md"

    await environment.store.save(foreign)
    await writeFileAtomic(
      environment.store.reviewFile(environment.planSlug),
      ReviewStateCodec.serialize({ ...foreign, planFile: foreignPlanFile })
    )

    const input = createHookInput(
      environment,
      "pre-tool-use-exit-plan-mode.json"
    )

    // Throwing is the point: the gate turns it into a deny, and every recorder
    // runs inside the dispatcher's guard, which records nothing.
    await expect(locateReview(input, environment.context)).rejects.toThrow(
      ReviewLookup.newForeignReviewMessage(
        environment.planSlug,
        foreignPlanFile,
        environment.planFile
      )
    )
  })

  it("returns nothing when no source knows a plan file", async () => {
    await rm(environment.transcriptPath, { force: true })

    const input = createHookInput(
      environment,
      "pre-tool-use-exit-plan-mode.json"
    )

    expect(await locateReview(input, environment.context)).toBeNull()
  })
})
