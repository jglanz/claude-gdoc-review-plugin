import {
  ApproveAutoMode,
  handlePermissionRequest,
  HookInput,
  PermissionBehavior,
  PermissionMode,
  PermissionRequestHookInput,
  PermissionRequestHookOutput,
  PermissionUpdateDestination,
  PermissionRequestHandler,
  PermissionUpdateType,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewState,
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

const Fixture = "permission-request-exit-plan-mode.json",
  AutoSuggestions = [
    {
      type: PermissionUpdateType.setMode,
      mode: PermissionMode.auto,
      destination: "session"
    }
  ]

function asPermissionRequest(input: HookInput): PermissionRequestHookInput {
  return input as PermissionRequestHookInput
}

function modeOf(output: unknown): PermissionMode {
  const [update] = (output as PermissionRequestHookOutput).hookSpecificOutput
    .decision.updatedPermissions
  return update.mode
}

function createApprovedState(
  environment: HookTestEnvironment,
  planSha256: string,
  choice: ReviewDecisionChoice = ReviewDecisionChoice.approve_auto
): ReviewState {
  return createActiveReviewState(environment, {
    revision: 1,
    lastSync: { at: FixtureNow.toISOString(), planSha256, revision: 1 },
    decision: {
      choice,
      label: choice,
      text: null,
      planSha256,
      at: FixtureNow.toISOString(),
      source: ReviewDecisionSource.ask_user_question,
      toolUseId: null,
      consumedAt: null
    }
  })
}

describe("handlePermissionRequest", () => {
  const inlineEnvironments: HookTestEnvironment[] = []

  let environment: HookTestEnvironment = null,
    planSha256: string = null,
    input: PermissionRequestHookInput = null

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
    input = asPermissionRequest(createHookInput(environment, Fixture))
  })

  afterEach(async () => {
    try {
      await destroyHookTestEnvironment(environment)
    } finally {
      await destroyHookTestEnvironments(inlineEnvironments)
    }
  })

  it("allows the approval and switches the session into accept-edits mode", async () => {
    await environment.store.save(createApprovedState(environment, planSha256))

    const output = (await handlePermissionRequest(
      input,
      environment.context
    )) as PermissionRequestHookOutput

    expect(output.hookSpecificOutput.decision).toEqual({
      behavior: PermissionBehavior.allow,
      updatedPermissions: [
        {
          type: PermissionUpdateType.setMode,
          mode: PermissionMode.acceptEdits,
          destination: PermissionUpdateDestination.session
        }
      ]
    })
  })

  it("switches into the engine's default mode for the manual approval", async () => {
    await environment.store.save(
      createApprovedState(
        environment,
        planSha256,
        ReviewDecisionChoice.approve_manual
      )
    )

    expect(
      modeOf(await handlePermissionRequest(input, environment.context))
    ).toBe(PermissionMode.default)
  })

  it("requests auto mode when it is configured and the prompt offers it", async () => {
    const autoEnvironment = await createInlineEnvironment({
        config: createTestPluginConfig(ApproveAutoMode.auto)
      }),
      autoSha256 = await writePlanText(autoEnvironment, "# Fixture plan\n")

    await autoEnvironment.store.save(
      createApprovedState(autoEnvironment, autoSha256)
    )

    const autoInput = asPermissionRequest(
      createHookInput(autoEnvironment, Fixture, {
        permission_suggestions: AutoSuggestions
      })
    )

    expect(
      modeOf(await handlePermissionRequest(autoInput, autoEnvironment.context))
    ).toBe(PermissionMode.auto)
  })

  it("falls back to accept-edits when auto is configured but not offered", async () => {
    const autoEnvironment = await createInlineEnvironment({
        config: createTestPluginConfig(ApproveAutoMode.auto)
      }),
      autoSha256 = await writePlanText(autoEnvironment, "# Fixture plan\n")

    await autoEnvironment.store.save(
      createApprovedState(autoEnvironment, autoSha256)
    )

    const autoInput = asPermissionRequest(
      createHookInput(autoEnvironment, Fixture)
    )

    expect(
      modeOf(await handlePermissionRequest(autoInput, autoEnvironment.context))
    ).toBe(PermissionMode.acceptEdits)
  })

  it("leaves the built-in dialog in place for a decision given for other plan text", async () => {
    const state = createApprovedState(environment, planSha256)

    await environment.store.save({
      ...state,
      decision: { ...state.decision, planSha256: "stale-digest" }
    })

    expect(await handlePermissionRequest(input, environment.context)).toBeNull()
  })

  it("marks the decision consumed and answers only the first prompt", async () => {
    await environment.store.save(createApprovedState(environment, planSha256))

    expect(
      modeOf(await handlePermissionRequest(input, environment.context))
    ).toBe(PermissionMode.acceptEdits)
    expect(
      (await environment.store.load(environment.planSlug)).decision.consumedAt
    ).toBe(FixtureNow.toISOString())
    expect(await handlePermissionRequest(input, environment.context)).toBeNull()
  })

  it("leaves the built-in dialog in place for a decision older than the age limit", async () => {
    const state = createApprovedState(environment, planSha256),
      staleAt = new Date(
        FixtureNow.getTime() - PermissionRequestHandler.MaxDecisionAgeMs - 1
      )

    await environment.store.save({
      ...state,
      decision: { ...state.decision, at: staleAt.toISOString() }
    })

    expect(await handlePermissionRequest(input, environment.context)).toBeNull()
  })

  it("leaves the built-in dialog in place for a decision recorded through the CLI", async () => {
    const state = createApprovedState(environment, planSha256)

    await environment.store.save({
      ...state,
      decision: { ...state.decision, source: ReviewDecisionSource.cli }
    })

    expect(await handlePermissionRequest(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision.consumedAt
    ).toBeNull()
  })

  it("leaves the built-in dialog in place when the Doc is out of date", async () => {
    const state = createApprovedState(environment, planSha256)

    await environment.store.save({ ...state, lastSync: null })

    expect(await handlePermissionRequest(input, environment.context)).toBeNull()
  })

  it("leaves the built-in dialog in place for a non-approval choice", async () => {
    await environment.store.save(
      createApprovedState(
        environment,
        planSha256,
        ReviewDecisionChoice.check_doc
      )
    )

    expect(await handlePermissionRequest(input, environment.context)).toBeNull()
  })

  it("leaves the built-in dialog in place for an inactive or missing review", async () => {
    expect(await handlePermissionRequest(input, environment.context)).toBeNull()

    await environment.store.save({
      ...createApprovedState(environment, planSha256),
      status: ReviewStatus.approved
    })

    expect(await handlePermissionRequest(input, environment.context)).toBeNull()
  })

  describe("isDecisionUsable", () => {
    const usable = {
      choice: ReviewDecisionChoice.approve_auto,
      label: `${ReviewDecisionChoice.approve_auto}`,
      text: null,
      planSha256: "digest",
      at: FixtureNow.toISOString(),
      source: ReviewDecisionSource.ask_user_question,
      toolUseId: null,
      consumedAt: null
    }

    /** The clock reading that puts a decision exactly `ageMs` in the past. */
    function now(ageMs: number): Date {
      return new Date(FixtureNow.getTime() + ageMs)
    }

    it("accepts an unspent decision up to, but not at, the age limit", () => {
      const { MaxDecisionAgeMs: limit } = PermissionRequestHandler

      expect(PermissionRequestHandler.isDecisionUsable(usable, now(0))).toBe(
        true
      )
      expect(
        PermissionRequestHandler.isDecisionUsable(usable, now(limit - 1))
      ).toBe(true)
      // The comparison is strict, so the decision stops counting the moment it
      // reaches the limit rather than a millisecond later.
      expect(
        PermissionRequestHandler.isDecisionUsable(usable, now(limit))
      ).toBe(false)
      expect(
        PermissionRequestHandler.isDecisionUsable(usable, now(limit + 1))
      ).toBe(false)
    })

    it("refuses a decision dated in the future", () => {
      // A future timestamp would otherwise read as "very fresh" and stay usable
      // for as long as it is ahead, which is the one thing the age window is
      // there to prevent.
      expect(PermissionRequestHandler.isDecisionUsable(usable, now(-1))).toBe(
        false
      )
      expect(
        PermissionRequestHandler.isDecisionUsable(
          usable,
          now(-PermissionRequestHandler.MaxDecisionAgeMs)
        )
      ).toBe(false)
    })

    it("refuses a spent decision, an undated one and no decision", () => {
      expect(
        PermissionRequestHandler.isDecisionUsable(
          { ...usable, consumedAt: FixtureNow.toISOString() },
          now(0)
        )
      ).toBe(false)
      expect(
        PermissionRequestHandler.isDecisionUsable(
          { ...usable, at: "whenever" },
          now(0)
        )
      ).toBe(false)
      expect(PermissionRequestHandler.isDecisionUsable(null, now(0))).toBe(
        false
      )
    })
  })
})
