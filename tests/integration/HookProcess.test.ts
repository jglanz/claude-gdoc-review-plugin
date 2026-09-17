import { rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  ExitPlanModeGateHandler,
  Logger,
  PermissionBehavior,
  PermissionDecision,
  PermissionMode,
  PermissionUpdateDestination,
  PermissionUpdateType,
  PluginConfig,
  ReviewDecisionChoice,
  sha256OfText
} from "claude-gdoc-review-plugin"

import type { BundleTestEnvironment } from "../support/processTestSupport.js"
import {
  BundleFile,
  createBundlePayload,
  createBundleTestEnvironment,
  destroyBundleTestEnvironment,
  ProcessDocUrl,
  ProcessPlanText,
  runBundle,
  runBundleSetup
} from "../support/processTestSupport.js"

describe("hook process without a review", () => {
  let environment: BundleTestEnvironment = null

  beforeAll(async () => {
    environment = await createBundleTestEnvironment()
  })

  afterAll(async () => {
    await destroyBundleTestEnvironment(environment)
  })

  it("stays silent for ExitPlanMode when no state exists", async () => {
    const result = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      )
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })

  it("stays silent for malformed stdin", async () => {
    const result = await runBundle(environment, ["hook"], {
      stdin: "{not json at all"
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })

  it("stays silent for an empty object on stdin", async () => {
    const result = await runBundle(environment, ["hook"], { stdin: "{}" })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("stays silent for empty stdin", async () => {
    const result = await runBundle(environment, ["hook"], { stdin: "" })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("degrades to the defaults for a config.json that is not JSON", async () => {
    await writeFile(
      path.join(environment.configPath, "gdoc-review", "config.json"),
      "{ not json",
      "utf8"
    )

    const result = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      )
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")

    await rm(path.join(environment.configPath, "gdoc-review", "config.json"), {
      force: true
    })
  })

  it("degrades to the defaults for an unusable environment override", async () => {
    const result = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      ),
      environmentOverrides: { GDOC_REVIEW_APPROVE_MODE: "bogus" }
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })
})

describe("hook process whose context cannot be built", () => {
  let environment: BundleTestEnvironment = null,
    brokenConfigFile: string = null

  beforeAll(async () => {
    environment = await createBundleTestEnvironment()
    brokenConfigFile = path.join(environment.workspacePath, "not-a-directory")
    await writeFile(brokenConfigFile, "", "utf8")
  })

  afterAll(async () => {
    await destroyBundleTestEnvironment(environment)
  })

  it("denies ExitPlanMode rather than letting the plan through", async () => {
    const result = await runBundle(environment, ["hook"], {
        stdin: createBundlePayload(
          environment,
          "pre-tool-use-exit-plan-mode.json"
        ),
        environmentOverrides: {
          [PluginConfig.ConfigDirectoryEnvironmentKey]: brokenConfigFile
        }
      }),
      output = JSON.parse(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.deny
    )
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
      ExitPlanModeGateHandler.FailureReason
    )
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
      Logger.FileName
    )
  })

  it("stays silent for every other event", async () => {
    const payloads = [
      "pre-tool-use-bash-cli.json",
      "post-tool-use-exit-plan-mode.json",
      "permission-request-exit-plan-mode.json",
      "session-start-resume.json"
    ]

    for (const payload of payloads) {
      const result = await runBundle(environment, ["hook"], {
        stdin: createBundlePayload(environment, payload),
        environmentOverrides: {
          [PluginConfig.ConfigDirectoryEnvironmentKey]: brokenConfigFile
        }
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("")
    }
  })
})

describe("hook process with a registered review", () => {
  let environment: BundleTestEnvironment = null

  beforeAll(async () => {
    environment = await createBundleTestEnvironment()
    await runBundleSetup(environment)
  })

  afterAll(async () => {
    await destroyBundleTestEnvironment(environment)
  })

  /**
   * One round, start to finish, through the committed bundle. The steps share
   * one review document and each one depends on what the previous step wrote,
   * so they are one test rather than nine: split across `it`s, running any of
   * them alone with `-t` would exercise a state the plugin never produces.
   */
  it("runs the full review round through the bundle", async () => {
    // 1. The gate denies with the rendered round protocol.
    const denied = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      )
    })

    expect(denied.exitCode).toBe(0)
    expect(denied.stderr).toBe("")

    const { hookSpecificOutput: deniedOutput } = JSON.parse(denied.stdout)
    expect(deniedOutput.hookEventName).toBe("PreToolUse")
    expect(deniedOutput.permissionDecision).toBe(PermissionDecision.deny)
    expect(deniedOutput.permissionDecisionReason).toContain(
      "# Google Doc review round"
    )
    expect(deniedOutput.permissionDecisionReason).toContain(ProcessDocUrl)
    expect(deniedOutput.permissionDecisionReason).toContain(
      environment.planFile
    )
    expect(deniedOutput.permissionDecisionReason).toContain("revision 1")
    expect(deniedOutput.permissionDecisionReason).toContain(
      "Approve and Use Auto Mode"
    )

    // 2. The plugin's own CLI is auto-allowed through the Bash gate.
    const command = `node "${BundleFile}" status --plan ${environment.planFile}`,
      allowedCli = await runBundle(environment, ["hook"], {
        stdin: createBundlePayload(environment, "pre-tool-use-bash-cli.json", {
          tool_input: { command, description: "Check the review" }
        })
      })

    expect(allowedCli.exitCode).toBe(0)
    expect(
      JSON.parse(allowedCli.stdout).hookSpecificOutput.permissionDecision
    ).toBe(PermissionDecision.allow)

    // 3. An unrelated Bash command is left alone.
    const otherCommand = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(environment, "pre-tool-use-bash-other.json")
    })

    expect(otherCommand.exitCode).toBe(0)
    expect(otherCommand.stdout).toBe("")

    // 4. An MCP write aimed at the registered Doc is allowed.
    const allowedWrite = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "pre-tool-use-mcp-update-drive-file.json"
      )
    })

    expect(allowedWrite.exitCode).toBe(0)
    expect(
      JSON.parse(allowedWrite.stdout).hookSpecificOutput.permissionDecision
    ).toBe(PermissionDecision.allow)

    // 5. The successful write is recorded as revision 1.
    const synced = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "post-tool-use-update-drive-file.json"
      )
    })

    expect(synced.exitCode).toBe(0)

    const { hookSpecificOutput: syncedOutput } = JSON.parse(synced.stdout)
    expect(syncedOutput.hookEventName).toBe("PostToolUse")
    expect(syncedOutput.additionalContext).toContain("revision 1 synced")

    const afterSync = await environment.store.load(environment.planSlug)
    expect(afterSync.revision).toBe(1)
    expect(afterSync.lastSync).toEqual({
      at: expect.any(String),
      planSha256: sha256OfText(ProcessPlanText),
      revision: 1
    })

    // 6. The approval the user picked on the menu is recorded.
    const answered = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "post-tool-use-ask-user-question-approve-auto.json"
      )
    })

    expect(answered.exitCode).toBe(0)
    expect(
      JSON.parse(answered.stdout).hookSpecificOutput.additionalContext
    ).toContain("call ExitPlanMode now")

    const { decision } = await environment.store.load(environment.planSlug)
    expect(decision.choice).toBe(ReviewDecisionChoice.approve_auto)
    expect(decision.planSha256).toBe(sha256OfText(ProcessPlanText))

    // 7. The permission prompt is answered with the session mode switch.
    const approved = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "permission-request-exit-plan-mode.json"
      )
    })

    expect(approved.exitCode).toBe(0)
    expect(JSON.parse(approved.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: PermissionBehavior.allow,
          updatedPermissions: [
            {
              type: PermissionUpdateType.setMode,
              mode: PermissionMode.acceptEdits,
              destination: PermissionUpdateDestination.session
            }
          ]
        }
      }
    })

    // 8. The approval is spent: a second prompt is left to the built-in dialog.
    const secondPrompt = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "permission-request-exit-plan-mode.json"
      )
    })

    expect(secondPrompt.exitCode).toBe(0)
    expect(secondPrompt.stdout).toBe("")

    // 9. ...and the gate demands the menu again.
    const demanded = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      )
    })

    expect(demanded.exitCode).toBe(0)

    const { hookSpecificOutput: demandedOutput } = JSON.parse(demanded.stdout)
    expect(demandedOutput.permissionDecision).toBe(PermissionDecision.deny)
    expect(demandedOutput.permissionDecisionReason).toContain(
      "no approval decision is recorded"
    )

    // 10. A fresh approval opens the gate again.
    await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "post-tool-use-ask-user-question-approve-auto.json"
      )
    })

    const reopened = await runBundle(environment, ["hook"], {
      stdin: createBundlePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json"
      )
    })

    expect(reopened.exitCode).toBe(0)
    expect(reopened.stdout).toBe("")
  })
})
