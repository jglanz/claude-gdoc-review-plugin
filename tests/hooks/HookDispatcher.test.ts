import {
  dispatchHook,
  ExitPlanModeGateHandler,
  HookContext,
  HookDispatcher,
  PermissionDecision,
  PermissionRequestHookOutput,
  PlanFileLocator,
  PostToolUseHookOutput,
  PreToolUseHookOutput,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewStatus,
  SessionStartHookOutput,
  SyncRecorderHandler
} from "claude-gdoc-review-plugin"

import {
  createActiveReviewState,
  createHookInput,
  createHookTestEnvironment,
  destroyHookTestEnvironment,
  FixtureBundleFile,
  FixtureMenuRevision,
  FixtureNow,
  HookTestEnvironment,
  writePlanText
} from "../support/hookTestSupport.js"

const PlanText = "# Fixture plan\n\nCache the results in Redis.\n"

/**
 * A context whose plan-file lookup always throws, with every `error` call
 * captured so a test can assert what the dispatcher logged.
 */
function newBrokenContext(
  context: HookContext,
  failures: string[]
): HookContext {
  return {
    ...context,
    locator: {
      locate: () => Promise.reject(new Error("transcript unreadable"))
    } as unknown as PlanFileLocator,
    log: {
      ...context.log,
      error: (...args: unknown[]) => {
        failures.push(args.join(" "))
        return null
      }
    }
  }
}

describe("dispatchHook", () => {
  let environment: HookTestEnvironment = null,
    planSha256: string = null

  beforeEach(async () => {
    environment = await createHookTestEnvironment()
    planSha256 = await writePlanText(environment, PlanText)
  })

  afterEach(async () => {
    await destroyHookTestEnvironment(environment)
  })

  it("routes a PreToolUse ExitPlanMode call to the gate", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const output = (await dispatchHook(
      createHookInput(environment, "pre-tool-use-exit-plan-mode.json"),
      environment.context
    )) as PreToolUseHookOutput

    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.deny
    )
  })

  it("routes a PreToolUse Bash call to the allow-list", async () => {
    const output = (await dispatchHook(
      createHookInput(environment, "pre-tool-use-bash-cli.json", {
        tool_input: {
          command: `node "${FixtureBundleFile}" init --plan "${environment.planFile}" --kind personal --path "code/claude/wip/FixturePlan"`,
          description: "Start a Google Doc plan review"
        }
      }),
      environment.context
    )) as PreToolUseHookOutput

    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.allow
    )
  })

  it("routes a PreToolUse MCP write to the workspace gate", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const output = (await dispatchHook(
      createHookInput(environment, "pre-tool-use-mcp-update-drive-file.json"),
      environment.context
    )) as PreToolUseHookOutput

    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.allow
    )
  })

  it("routes a PostToolUse sync to the sync recorder", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const output = (await dispatchHook(
      createHookInput(environment, "post-tool-use-update-drive-file.json"),
      environment.context
    )) as PostToolUseHookOutput

    expect(output.hookSpecificOutput.additionalContext).toBe(
      SyncRecorderHandler.newSyncedMessage(1)
    )
  })

  it("routes a PostToolUse comment call to the comment recorder", async () => {
    await environment.store.save(createActiveReviewState(environment))

    expect(
      await dispatchHook(
        createHookInput(
          environment,
          "post-tool-use-manage-comment-create.json"
        ),
        environment.context
      )
    ).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).logCommentId
    ).toBe("comment-log-1")
  })

  it("routes a PostToolUse menu answer to the decision capture", async () => {
    await environment.store.save(
      createActiveReviewState(environment, { revision: FixtureMenuRevision })
    )

    const output = (await dispatchHook(
      createHookInput(
        environment,
        "post-tool-use-ask-user-question-approve-auto.json"
      ),
      environment.context
    )) as PostToolUseHookOutput

    expect(output.hookSpecificOutput.additionalContext).toContain(
      "ExitPlanMode"
    )
    expect(
      (await environment.store.load(environment.planSlug)).decision.choice
    ).toBe(ReviewDecisionChoice.approve_auto)
  })

  it("routes a PostToolUse ExitPlanMode call to the completion handler", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        decision: {
          choice: ReviewDecisionChoice.approve_manual,
          label: "Approve Manual Mode",
          text: null,
          planSha256,
          at: FixtureNow.toISOString(),
          source: ReviewDecisionSource.ask_user_question,
          toolUseId: null,
          consumedAt: FixtureNow.toISOString()
        }
      })
    )

    await dispatchHook(
      createHookInput(environment, "post-tool-use-exit-plan-mode.json"),
      environment.context
    )

    expect((await environment.store.load(environment.planSlug)).status).toBe(
      ReviewStatus.approved
    )
  })

  it("routes a PermissionRequest to the approval handler", async () => {
    await environment.store.save(
      createActiveReviewState(environment, {
        revision: 1,
        lastSync: { at: FixtureNow.toISOString(), planSha256, revision: 1 },
        decision: {
          choice: ReviewDecisionChoice.approve_auto,
          label: "Approve and Use Auto Mode",
          text: null,
          planSha256,
          at: FixtureNow.toISOString(),
          source: ReviewDecisionSource.ask_user_question,
          toolUseId: null,
          consumedAt: null
        }
      })
    )

    const output = (await dispatchHook(
      createHookInput(environment, "permission-request-exit-plan-mode.json"),
      environment.context
    )) as PermissionRequestHookOutput

    expect(output.hookSpecificOutput.decision.updatedPermissions).toHaveLength(
      1
    )
  })

  it("routes a SessionStart to the reminder handler", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const output = (await dispatchHook(
      createHookInput(environment, "session-start-resume.json"),
      environment.context
    )) as SessionStartHookOutput

    expect(output.hookSpecificOutput.additionalContext).toContain(
      environment.planFile
    )
  })

  it("stays silent for a tool no handler claims", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const readTool = createHookInput(
        environment,
        "post-tool-use-update-drive-file.json",
        {
          tool_name: "mcp__gworkspace-personal__list_document_comments"
        }
      ),
      foreignTool = createHookInput(
        environment,
        "post-tool-use-exit-plan-mode.json",
        {
          tool_name: "Write"
        }
      ),
      foreignPermission = createHookInput(
        environment,
        "permission-request-exit-plan-mode.json",
        { tool_name: "Bash" }
      )

    expect(await dispatchHook(readTool, environment.context)).toBeNull()
    expect(await dispatchHook(foreignTool, environment.context)).toBeNull()
    expect(
      await dispatchHook(foreignPermission, environment.context)
    ).toBeNull()
  })

  it("logs and swallows a recorder failure instead of breaking the session", async () => {
    const failures: string[] = [],
      brokenContext = newBrokenContext(environment.context, failures)

    expect(
      await dispatchHook(
        createHookInput(environment, "post-tool-use-update-drive-file.json"),
        brokenContext
      )
    ).toBeNull()
    expect(failures.join(" ")).toContain(HookDispatcher.HandlerFailureMessage)
    expect(failures.join(" ")).toContain("transcript unreadable")
  })

  it("lets the ExitPlanMode gate fail closed rather than swallowing it", async () => {
    const failures: string[] = [],
      brokenContext = newBrokenContext(environment.context, failures),
      output = (await dispatchHook(
        createHookInput(environment, "pre-tool-use-exit-plan-mode.json"),
        brokenContext
      )) as PreToolUseHookOutput

    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.deny
    )
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
      ExitPlanModeGateHandler.FailureReason
    )
    expect(failures.join(" ")).toContain("transcript unreadable")
  })
})
