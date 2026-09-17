import {
  ApproveAutoMode,
  ExitPlanModeCompletionHandler,
  handleExitPlanModeCompletion,
  HookInput,
  PermissionMode,
  PermissionRequestHandler,
  PostToolUseHookInput,
  ReviewDecision,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewStatus
} from "claude-gdoc-review-plugin"

import {
  createActiveReviewState,
  createHookInput,
  createHookTestEnvironment,
  createTestPluginConfig,
  destroyHookTestEnvironment,
  destroyHookTestEnvironments,
  FixtureNow,
  HookTestEnvironment,
  writePlanText
} from "../../support/hookTestSupport.js"

const Fixture = "post-tool-use-exit-plan-mode.json"

function asPostToolUse(input: HookInput): PostToolUseHookInput {
  return input as PostToolUseHookInput
}

/**
 * A menu answer the permission hook already spent, which is the only shape
 * that closes a review.
 */
function createDecision(
  choice: ReviewDecisionChoice,
  planSha256: string
): ReviewDecision {
  return {
    choice,
    label: choice,
    text: null,
    planSha256,
    at: FixtureNow.toISOString(),
    source: ReviewDecisionSource.ask_user_question,
    toolUseId: null,
    consumedAt: FixtureNow.toISOString()
  }
}

describe("handleExitPlanModeCompletion", () => {
  const inlineEnvironments: HookTestEnvironment[] = []

  let environment: HookTestEnvironment = null,
    planSha256: string = null,
    input: PostToolUseHookInput = null

  /**
   * Builds a second environment the `afterEach` will destroy whatever the test
   * does, so a failing assertion cannot leave its directories behind.
   */
  async function createInlineEnvironment(
    options: Parameters<typeof createHookTestEnvironment>[0] = {}
  ): Promise<HookTestEnvironment> {
    const inline = await createHookTestEnvironment(options)
    inlineEnvironments.push(inline)
    return inline
  }

  beforeEach(async () => {
    environment = await createHookTestEnvironment()
    planSha256 = await writePlanText(environment, "# Fixture plan\n")
    input = asPostToolUse(createHookInput(environment, Fixture))
  })

  afterEach(async () => {
    try {
      await destroyHookTestEnvironment(environment)
    } finally {
      await destroyHookTestEnvironments(inlineEnvironments)
    }
  })

  it("closes the review and records the mode it was approved in", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        decision: createDecision(ReviewDecisionChoice.approve_auto, planSha256)
      })
    )

    expect(
      await handleExitPlanModeCompletion(input, environment.context)
    ).toBeNull()
    expect(await environment.store.load(environment.planSlug)).toMatchObject({
      status: ReviewStatus.approved,
      approvedAt: FixtureNow.toISOString(),
      approvedMode: PermissionMode.acceptEdits
    })
  })

  it("records the manual mode for the manual approval", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        decision: createDecision(
          ReviewDecisionChoice.approve_manual,
          planSha256
        )
      })
    )

    await handleExitPlanModeCompletion(input, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).approvedMode
    ).toBe(PermissionMode.default)
  })

  it("records accept-edits when auto is configured but was never offered", async () => {
    const autoEnvironment = await createInlineEnvironment({
        config: createTestPluginConfig(ApproveAutoMode.auto)
      }),
      autoSha256 = await writePlanText(autoEnvironment, "# Fixture plan\n")

    await autoEnvironment.store.save(
      createActiveReviewState(autoEnvironment, {
        decision: createDecision(ReviewDecisionChoice.approve_auto, autoSha256)
      })
    )

    await handleExitPlanModeCompletion(
      asPostToolUse(createHookInput(autoEnvironment, Fixture)),
      autoEnvironment.context
    )

    expect(
      (await autoEnvironment.store.load(autoEnvironment.planSlug)).approvedMode
    ).toBe(PermissionMode.acceptEdits)
  })

  it("leaves a review without an approval untouched", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        decision: createDecision(ReviewDecisionChoice.check_doc, planSha256)
      })
    )

    expect(
      await handleExitPlanModeCompletion(input, environment.context)
    ).toBeNull()
    expect((await environment.store.load(environment.planSlug)).status).toBe(
      ReviewStatus.active
    )
  })

  it("leaves the review active for a menu answer no permission hook spent", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        decision: {
          ...createDecision(ReviewDecisionChoice.approve_auto, planSha256),
          consumedAt: null
        }
      })
    )

    expect(
      await handleExitPlanModeCompletion(input, environment.context)
    ).toBeNull()
    // An unspent answer proves nothing: the user may have answered Claude
    // Code's own dialog while it sat there, and the mode would be invented.
    expect(await environment.store.load(environment.planSlug)).toMatchObject({
      status: ReviewStatus.active,
      approvedAt: null,
      approvedMode: null
    })
  })

  it("reports an approving decision only when it is a spent menu answer", () => {
    const spent = createDecision(ReviewDecisionChoice.approve_auto, planSha256)

    expect(ExitPlanModeCompletionHandler.isApprovingDecision(spent)).toBe(true)
    expect(
      ExitPlanModeCompletionHandler.isApprovingDecision({
        ...spent,
        consumedAt: null
      })
    ).toBe(false)
    expect(
      ExitPlanModeCompletionHandler.isApprovingDecision({
        ...spent,
        source: ReviewDecisionSource.cli
      })
    ).toBe(false)
    expect(ExitPlanModeCompletionHandler.isApprovingDecision(null)).toBe(false)
  })

  it("leaves the review active when the native dialog approved it", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        decision: {
          ...createDecision(ReviewDecisionChoice.approve_auto, planSha256),
          source: ReviewDecisionSource.cli
        }
      })
    )

    expect(
      await handleExitPlanModeCompletion(input, environment.context)
    ).toBeNull()
    expect(await environment.store.load(environment.planSlug)).toMatchObject({
      status: ReviewStatus.active,
      approvedAt: null,
      approvedMode: null
    })
  })

  it("closes the review on a spent menu answer however old it is", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        decision: {
          ...createDecision(ReviewDecisionChoice.approve_auto, planSha256),
          at: new Date(
            FixtureNow.getTime() - 2 * PermissionRequestHandler.MaxDecisionAgeMs
          ).toISOString()
        }
      })
    )

    await handleExitPlanModeCompletion(input, environment.context)

    // The freshness rule belongs to the permission hook, which already applied
    // it: `consumedAt` says that hook approved this very call.
    expect(await environment.store.load(environment.planSlug)).toMatchObject({
      status: ReviewStatus.approved,
      approvedMode: PermissionMode.acceptEdits
    })
  })

  it("leaves a review with no decision at all untouched", async () => {
    await environment.store.save(createActiveReviewState(environment))

    await handleExitPlanModeCompletion(input, environment.context)

    expect((await environment.store.load(environment.planSlug)).status).toBe(
      ReviewStatus.active
    )
  })

  it("stays silent when the plan has no review", async () => {
    expect(
      await handleExitPlanModeCompletion(input, environment.context)
    ).toBeNull()
  })
})
