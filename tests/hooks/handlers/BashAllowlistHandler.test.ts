import { rm } from "node:fs/promises"

import {
  BashAllowlistHandler,
  GatedCliSubcommand,
  handleBashAllowlist,
  HookInput,
  PermissionDecision,
  PermissionMode,
  PreToolUseHookInput,
  PreToolUseHookOutput
} from "claude-gdoc-review-plugin"

import {
  createActiveReviewState,
  createHookInput,
  createHookTestEnvironment,
  destroyHookTestEnvironment,
  destroyHookTestEnvironments,
  FixtureBundleFile,
  HookTestEnvironment
} from "../../support/hookTestSupport.js"

function asPreToolUse(input: HookInput): PreToolUseHookInput {
  return input as PreToolUseHookInput
}

function commandInput(
  environment: HookTestEnvironment,
  command: string
): PreToolUseHookInput {
  return asPreToolUse(
    createHookInput(environment, "pre-tool-use-bash-cli.json", {
      tool_input: { command, description: "a command" }
    })
  )
}

describe("handleBashAllowlist", () => {
  const inlineEnvironments: HookTestEnvironment[] = []

  let environment: HookTestEnvironment = null

  beforeEach(async () => {
    environment = await createHookTestEnvironment()
  })

  afterEach(async () => {
    try {
      await destroyHookTestEnvironment(environment)
    } finally {
      await destroyHookTestEnvironments(inlineEnvironments)
    }
  })

  it("allows a command repeating --plan, which the CLI then rejects", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = commandInput(
        environment,
        `node "${FixtureBundleFile}" status --plan "${environment.planFile}" --plan "${environment.planFile}"`
      ),
      output = (await handleBashAllowlist(
        input,
        environment.context
      )) as PreToolUseHookOutput

    // The matcher reads the first --plan, and both name the session's own plan,
    // so there is nothing for the gate to refuse. yargs turns the repetition
    // into an array, which the command's own --plan resolution rejects — see
    // the CLI-side half of this in tests/cli/index.test.ts.
    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.allow
    )
  })

  it("allows an init call whose --plan is the plan the session is presenting", async () => {
    const input = commandInput(
        environment,
        `node "${FixtureBundleFile}" init --plan "${environment.planFile}" --kind personal --path "code/claude/wip/FixturePlan"`
      ),
      output = (await handleBashAllowlist(
        input,
        environment.context
      )) as PreToolUseHookOutput

    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.allow
    )
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      BashAllowlistHandler.AllowReason
    )
  })

  it("stays silent for an init call naming a plan the session is not presenting", async () => {
    const input = commandInput(
      environment,
      `node "${FixtureBundleFile}" init --plan /etc/hosts --kind personal --path "code/claude/wip/FixturePlan"`
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("refuses a --plan naming another plan that is itself under review", async () => {
    const other = await createHookTestEnvironment()

    inlineEnvironments.push(other)
    await other.store.save(createActiveReviewState(other))
    await environment.store.save(createActiveReviewState(environment))

    // Both plans have an active review, so "does this plan have one" cannot
    // decide it: the command names a plan this session is not presenting, and
    // the gate cannot tell which of the two claims is the wrong one.
    const input = commandInput(
      environment,
      `node "${FixtureBundleFile}" status --plan "${other.planFile}"`
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("never defines the session's plan file", async () => {
    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-bash-cli.json")
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
    // The transcript, not the command line, is what the sessions cache holds:
    // the locator recorded the plan it scanned on the way through.
    await expect(
      environment.store.readSessionPlanRecord(environment.sessionId)
    ).resolves.toMatchObject({ planFile: environment.planFile })
  })

  it("allows a CLI invocation that names no plan file once the review exists", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = commandInput(
      environment,
      `node "${FixtureBundleFile}" status --json`
    )

    expect(await handleBashAllowlist(input, environment.context)).not.toBeNull()
  })

  it("stays silent for a flag no auto-allowed subcommand takes", async () => {
    await environment.store.save(createActiveReviewState(environment))

    expect(
      await handleBashAllowlist(
        commandInput(
          environment,
          `node "${FixtureBundleFile}" status --stateDir /tmp/elsewhere`
        ),
        environment.context
      )
    ).toBeNull()
    expect(
      await handleBashAllowlist(
        commandInput(
          environment,
          `node "${FixtureBundleFile}" status --state_dir /tmp/elsewhere`
        ),
        environment.context
      )
    ).toBeNull()
    expect(
      await handleBashAllowlist(
        commandInput(
          environment,
          `node "${FixtureBundleFile}" status --comment-id abc`
        ),
        environment.context
      )
    ).toBeNull()
  })

  it("allows nothing at all when no plan file could be located", async () => {
    const withoutPlan = await createHookTestEnvironment()

    inlineEnvironments.push(withoutPlan)
    await rm(withoutPlan.transcriptPath, { force: true })
    await withoutPlan.store.save(createActiveReviewState(withoutPlan))

    // `init` included: with no plan-mode attachment the only source left is the
    // command line, which is the claim this gate refuses to act on.
    const commands = [
      `node "${FixtureBundleFile}" init --plan "${withoutPlan.planFile}" --kind personal --path "code/claude/wip/FixturePlan"`,
      `node "${FixtureBundleFile}" status --json`,
      `node "${FixtureBundleFile}" register --plan "${withoutPlan.planFile}" --doc-id d --doc-url u --folder-id f`
    ]

    for (const command of commands) {
      expect(
        await handleBashAllowlist(
          commandInput(withoutPlan, command),
          withoutPlan.context
        )
      ).toBeNull()
    }
  })

  it("does not let a --plan stand in for the missing transcript", async () => {
    const withoutPlan = await createHookTestEnvironment()

    inlineEnvironments.push(withoutPlan)
    await rm(withoutPlan.transcriptPath, { force: true })

    expect(
      await handleBashAllowlist(
        commandInput(
          withoutPlan,
          `node "${FixtureBundleFile}" init --plan /etc/hosts --kind personal --path "code/claude/wip/FixturePlan"`
        ),
        withoutPlan.context
      )
    ).toBeNull()
  })

  it("stays silent for a non-init subcommand while the plan has no review", async () => {
    const input = commandInput(
      environment,
      `node "${FixtureBundleFile}" status --json`
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("stays silent outside plan mode, even for a plan under review", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-bash-cli.json", {
        permission_mode: PermissionMode.acceptEdits
      })
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("stays silent when the payload carries no permission mode at all", async () => {
    const fixture = createHookInput(environment, "pre-tool-use-bash-cli.json")
    delete fixture.permission_mode

    expect(
      await handleBashAllowlist(asPreToolUse(fixture), environment.context)
    ).toBeNull()
  })

  it("stays silent for the subcommands that write what the gate trusts", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = commandInput(
      environment,
      `node "${FixtureBundleFile}" ${GatedCliSubcommand.decision} --plan ${environment.planFile} --choice approve_auto`
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("stays silent for a CLI invocation pointing at another state directory", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = commandInput(
      environment,
      `node "${FixtureBundleFile}" status --state-dir /tmp/elsewhere`
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("stays silent for any other command", async () => {
    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-bash-other.json")
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("stays silent for a CLI invocation carrying a shell metacharacter", async () => {
    const input = commandInput(
      environment,
      `node "${FixtureBundleFile}" status ; rm -rf /tmp/gdoc-review-hook-state`
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("stays silent for a launcher that is not this plugin's", async () => {
    const input = commandInput(
      environment,
      "node /elsewhere/gdoc-review.cjs status"
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })

  it("stays silent when the call carries no command at all", async () => {
    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-bash-cli.json", {
        tool_input: {}
      })
    )

    expect(await handleBashAllowlist(input, environment.context)).toBeNull()
  })
})
