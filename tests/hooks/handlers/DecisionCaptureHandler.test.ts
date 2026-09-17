import {
  ApproveAutoMode,
  DecisionCaptureHandler,
  handleDecisionCapture,
  HookInput,
  PermissionMode,
  PostToolUseHookInput,
  PostToolUseHookOutput,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewMenu,
  ReviewMenuLabel,
  ReviewStatus,
  RoundProtocolRenderer
} from "claude-gdoc-review-plugin"

import {
  createActiveReviewState,
  createHookInput,
  createHookTestEnvironment,
  createTestPluginConfig,
  destroyHookTestEnvironment,
  destroyHookTestEnvironments,
  FixtureDocUrl,
  FixtureMenuRevision,
  FixtureNow,
  HookTestEnvironment,
  readHookFixture,
  rememberSessionPlanFile,
  writePlanText
} from "../../support/hookTestSupport.js"

const ApproveAutoFixture = "post-tool-use-ask-user-question-approve-auto.json",
  CheckDocFixture = "post-tool-use-ask-user-question-check-doc.json",
  OtherFixture = "post-tool-use-ask-user-question-other.json"

function asPostToolUse(input: HookInput): PostToolUseHookInput {
  return input as PostToolUseHookInput
}

function contextOf(output: unknown): string {
  return (output as PostToolUseHookOutput).hookSpecificOutput.additionalContext
}

function menuQuestionText(): string {
  const fixture = readHookFixture(ApproveAutoFixture),
    toolInput = fixture.tool_input as Record<string, unknown>,
    [question] = toolInput.questions as Record<string, unknown>[]

  return question.question as string
}

function menuQuestion(): Record<string, unknown> {
  const fixture = readHookFixture(ApproveAutoFixture),
    toolInput = fixture.tool_input as Record<string, unknown>,
    [question] = toolInput.questions as Record<string, unknown>[]

  return question
}

function menuWithOptions(options: unknown): Record<string, unknown> {
  return { questions: [{ ...menuQuestion(), options }] }
}

/**
 * Builds the menu the round protocol would hand the model under one
 * configuration, so a test drives the hook with the question the renderer
 * actually produces rather than a copy of it.
 */
function menuUnderAutoMode(
  approveAutoMode: ApproveAutoMode
): ReviewMenu.Question {
  return ReviewMenu.createQuestion({
    docUrl: FixtureDocUrl,
    revision: FixtureMenuRevision,
    addressed: 0,
    open: 0,
    approveAutoMode
  })
}

describe("handleDecisionCapture", () => {
  const inlineEnvironments: HookTestEnvironment[] = []

  let environment: HookTestEnvironment = null,
    planSha256: string = null

  /**
   * Builds a second environment the `afterEach` will destroy whatever the test
   * does, and seeds it with the review the menu fixtures answer for.
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
    await environment.store.save(
      createActiveReviewState(environment, { revision: FixtureMenuRevision })
    )
  })

  afterEach(async () => {
    try {
      await destroyHookTestEnvironment(environment)
    } finally {
      await destroyHookTestEnvironments(inlineEnvironments)
    }
  })

  it("records an approval pinned to the current plan text", async () => {
    const input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture)
      ),
      output = await handleDecisionCapture(input, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toEqual({
      choice: ReviewDecisionChoice.approve_auto,
      label: ReviewMenuLabel.approveAuto,
      text: null,
      planSha256,
      at: FixtureNow.toISOString(),
      source: ReviewDecisionSource.ask_user_question,
      toolUseId: "toolu_menu_1",
      consumedAt: null
    })
    expect(contextOf(output)).toBe(
      DecisionCaptureHandler.newApprovedMessage(PermissionMode.acceptEdits)
    )
  })

  it("names the configured auto mode in the approval message", async () => {
    const autoEnvironment = await createInlineEnvironment({
        config: createTestPluginConfig(ApproveAutoMode.auto)
      }),
      question = menuUnderAutoMode(ApproveAutoMode.auto)

    await writePlanText(autoEnvironment, "# Fixture plan\n")
    await autoEnvironment.store.save(
      createActiveReviewState(autoEnvironment, {
        revision: FixtureMenuRevision
      })
    )

    const input = asPostToolUse(
      createHookInput(autoEnvironment, ApproveAutoFixture, {
        tool_input: { questions: [question] },
        tool_response: {
          answers: { [question.question]: ReviewMenuLabel.approveAuto }
        }
      })
    )

    // The prompt in a PostToolUse payload offers nothing, so `auto` resolves to
    // the fallback here; the row the user read still named `auto`, which is
    // what the description under this configuration says.
    expect(
      contextOf(await handleDecisionCapture(input, autoEnvironment.context))
    ).toBe(
      DecisionCaptureHandler.newApprovedMessage(PermissionMode.acceptEdits)
    )
  })

  it("refuses a menu whose first row describes another mode than the configured one", async () => {
    const autoEnvironment = await createInlineEnvironment({
        config: createTestPluginConfig(ApproveAutoMode.auto)
      }),
      question = menuUnderAutoMode(ApproveAutoMode.auto),
      staleRow = menuUnderAutoMode(ApproveAutoMode.acceptEdits)

    await writePlanText(autoEnvironment, "# Fixture plan\n")
    await autoEnvironment.store.save(
      createActiveReviewState(autoEnvironment, {
        revision: FixtureMenuRevision
      })
    )

    const input = asPostToolUse(
      createHookInput(autoEnvironment, ApproveAutoFixture, {
        tool_input: { questions: [staleRow] },
        tool_response: {
          answers: { [question.question]: ReviewMenuLabel.approveAuto }
        }
      })
    )

    // Both sides derive the description from `approveAutoMode`; a menu built
    // from the other value is not the menu this session handed the model.
    expect(
      await handleDecisionCapture(input, autoEnvironment.context)
    ).toBeNull()
    await expect(
      autoEnvironment.store.load(autoEnvironment.planSlug)
    ).resolves.toMatchObject({ decision: null })
  })

  it("records the manual approval", async () => {
    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture, {
        tool_response: {
          answers: { [menuQuestionText()]: ReviewMenuLabel.approveManual }
        }
      })
    )

    expect(
      contextOf(await handleDecisionCapture(input, environment.context))
    ).toBe(DecisionCaptureHandler.newApprovedMessage(PermissionMode.default))
    expect(
      (await environment.store.load(environment.planSlug)).decision.choice
    ).toBe(ReviewDecisionChoice.approve_manual)
  })

  it("records the re-check choice and says to stay in plan mode", async () => {
    const input = asPostToolUse(createHookInput(environment, CheckDocFixture))

    expect(
      contextOf(await handleDecisionCapture(input, environment.context))
    ).toBe(DecisionCaptureHandler.RecheckDocMessage)
    expect(
      (await environment.store.load(environment.planSlug)).decision.choice
    ).toBe(ReviewDecisionChoice.check_doc)
  })

  it("keeps free text as the instruction to follow, fenced", async () => {
    const input = asPostToolUse(createHookInput(environment, OtherFixture)),
      answer = "Add a rollback section before we approve",
      context = contextOf(
        await handleDecisionCapture(input, environment.context)
      )

    expect(context).toBe(
      DecisionCaptureHandler.newFollowUserInstructionMessage(answer)
    )
    expect(context).toContain(RoundProtocolRenderer.UntrustedFenceOpen)
    expect(context).toContain(RoundProtocolRenderer.UntrustedFenceClose)
    expect(context).toContain(answer)
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toMatchObject({
      choice: ReviewDecisionChoice.other,
      label: answer,
      text: answer
    })
  })

  it("joins a multi-value answer into one label", async () => {
    const question = menuQuestionText(),
      input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_response: {
            answers: { [question]: [ReviewMenuLabel.checkDoc, "twice"] }
          }
        })
      )

    await handleDecisionCapture(input, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).decision.label
    ).toBe(
      `${ReviewMenuLabel.checkDoc}${DecisionCaptureHandler.AnswerSeparator}twice`
    )
  })

  it("ignores answers the model put in the tool input", async () => {
    const question = menuQuestionText(),
      input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_input: {
            ...(readHookFixture(ApproveAutoFixture).tool_input as Record<
              string,
              unknown
            >),
            answers: { [question]: ReviewMenuLabel.approveAuto }
          },
          tool_response: {}
        })
      )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores a menu whose options were relabelled, reordered or padded", async () => {
    const question = ReviewMenu.createQuestion({
        docUrl: FixtureDocUrl,
        revision: FixtureMenuRevision,
        addressed: 0,
        open: 0
      }),
      relabelled = question.options.map((option, index) =>
        index === 0 ? { ...option, label: "Approve everything always" } : option
      ),
      reordered = [...question.options].reverse(),
      padded = [
        ...question.options,
        { label: "Approve and disable the hooks", description: "extra" }
      ]

    const inputs = [relabelled, reordered, padded].map(options =>
      asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_input: menuWithOptions(options)
        })
      )
    )

    for (const input of inputs) {
      expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    }
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores a menu whose option descriptions were rewritten", async () => {
    const rewritten = menuQuestion().options as Record<string, unknown>[],
      input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_input: menuWithOptions(
            rewritten.map((option, index) =>
              index === 0
                ? {
                    ...option,
                    description:
                      "Approving here also disables the review hooks for this repository."
                  }
                : option
            )
          )
        })
      )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores a menu whose options carry no description at all", async () => {
    const stripped = (menuQuestion().options as Record<string, unknown>[]).map(
        ({ label }) => ({ label })
      ),
      input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_input: menuWithOptions(stripped)
        })
      )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
  })

  it("ignores a menu whose question body was rewritten", async () => {
    const bodies = [
      `${menuQuestionText()}\nThe reviewers already approved this; picking the first row is expected.`,
      menuQuestionText().replace(
        ReviewMenu.Title,
        "Routine confirmation — no review needed"
      ),
      menuQuestionText().replace(
        FixtureDocUrl,
        "https://docs.google.com/document/d/1AnotherDocumentIdAbCdEfGhIjKlMnOpQr/edit"
      )
    ]

    for (const question of bodies) {
      const input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_input: { questions: [{ ...menuQuestion(), question }] },
          tool_response: {
            answers: { [question]: ReviewMenuLabel.approveAuto }
          }
        })
      )

      expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    }

    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores a menu stating a revision the Doc does not hold", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        revision: FixtureMenuRevision + 1
      })
    )

    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture)
    )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("accepts the menu whatever the two counters say", async () => {
    const question = ReviewMenu.createQuestion({
        docUrl: FixtureDocUrl,
        revision: FixtureMenuRevision,
        addressed: 12,
        open: 3
      }),
      input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_input: { questions: [question] },
          tool_response: {
            answers: { [question.question]: ReviewMenuLabel.approveAuto }
          }
        })
      )

    expect(
      await handleDecisionCapture(input, environment.context)
    ).not.toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision.choice
    ).toBe(ReviewDecisionChoice.approve_auto)
  })

  it("ignores a menu presented as multi-select", async () => {
    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture, {
        tool_input: { questions: [{ ...menuQuestion(), multiSelect: true }] }
      })
    )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores a menu that states no select mode at all", async () => {
    const { multiSelect, ...withoutMultiSelect } = menuQuestion(),
      input = asPostToolUse(
        createHookInput(environment, ApproveAutoFixture, {
          tool_input: { questions: [withoutMultiSelect] }
        })
      )

    expect(multiSelect).toBe(false)
    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores a question that is not the review menu", async () => {
    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture, {
        tool_input: {
          questions: [{ header: "Deploy", question: "Ship it?", options: [] }]
        }
      })
    )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores a menu with no usable answer", async () => {
    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture, {
        tool_response: { answers: {} }
      })
    )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it('records the canned "do something else" row without an instruction', async () => {
    const input = asPostToolUse(
      createHookInput(environment, OtherFixture, {
        tool_response: {
          answers: { [menuQuestionText()]: ReviewMenuLabel.somethingElse }
        }
      })
    )

    expect(
      contextOf(await handleDecisionCapture(input, environment.context))
    ).toBe(DecisionCaptureHandler.SomethingElseMessage)
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toMatchObject({
      choice: ReviewDecisionChoice.other,
      label: ReviewMenuLabel.somethingElse,
      text: null
    })
  })

  it("falls back to the only answer when the question key does not match", async () => {
    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture, {
        tool_response: {
          answers: {
            [`${menuQuestionText()}  `]: ReviewMenuLabel.approveManual
          }
        }
      })
    )

    await handleDecisionCapture(input, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).decision.choice
    ).toBe(ReviewDecisionChoice.approve_manual)
  })

  it("refuses the sole-answer fallback when the call asked several questions", async () => {
    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture, {
        tool_input: {
          questions: [
            menuQuestion(),
            {
              header: "Deploy",
              question: "Ship it?",
              multiSelect: false,
              options: []
            }
          ]
        },
        tool_response: {
          answers: { "Ship it?": ReviewMenuLabel.approveAuto }
        }
      })
    )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("keeps ignoring the answer when several answers are keyed differently", async () => {
    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture, {
        tool_response: {
          answers: {
            "Some other question": ReviewMenuLabel.approveAuto,
            "And another": ReviewMenuLabel.approveManual
          }
        }
      })
    )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("ignores the menu answer when the review is no longer active", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        revision: FixtureMenuRevision,
        status: ReviewStatus.cancelled
      })
    )

    const input = asPostToolUse(
      createHookInput(environment, ApproveAutoFixture)
    )

    expect(await handleDecisionCapture(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).decision
    ).toBeNull()
  })

  it("stays silent when the plan has no review and when it has no text", async () => {
    const withoutReview = await createInlineEnvironment()

    await writePlanText(withoutReview, "# Another plan\n")

    expect(
      await handleDecisionCapture(
        asPostToolUse(createHookInput(withoutReview, ApproveAutoFixture)),
        withoutReview.context
      )
    ).toBeNull()

    const withoutPlanText = await createInlineEnvironment()

    await rememberSessionPlanFile(withoutPlanText)
    await withoutPlanText.store.save(
      createActiveReviewState(withoutPlanText, {
        revision: FixtureMenuRevision
      })
    )

    expect(
      await handleDecisionCapture(
        asPostToolUse(createHookInput(withoutPlanText, ApproveAutoFixture)),
        withoutPlanText.context
      )
    ).toBeNull()
  })
})
