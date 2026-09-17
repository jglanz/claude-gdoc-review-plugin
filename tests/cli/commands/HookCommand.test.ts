import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  createHookCommand,
  ExitPlanModeGateHandler,
  HookCommand,
  HookCommandName,
  Logger,
  PermissionDecision
} from "claude-gdoc-review-plugin"

import { readHookFixture } from "../../support/hookTestSupport.js"
import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  CliDocUrl,
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli,
  runCliSetup
} from "../../support/cliTestSupport.js"

const HookSessionId = "cli-hook-session"

async function writeTranscript(
  environment: CliTestEnvironment
): Promise<string> {
  const transcriptPath = path.join(
    environment.workspacePath,
    "transcript.jsonl"
  )

  await writeFile(
    transcriptPath,
    JSON.stringify({
      type: "attachment",
      attachment: {
        type: "plan_mode",
        isSubAgent: false,
        planFilePath: environment.planFile
      }
    }),
    "utf8"
  )
  return transcriptPath
}

async function writePayload(
  environment: CliTestEnvironment,
  fixtureName: string,
  transcriptPath: string
): Promise<string> {
  const payloadFile = path.join(environment.workspacePath, "payload.json")

  await writeFile(
    payloadFile,
    JSON.stringify({
      ...readHookFixture(fixtureName),
      session_id: HookSessionId,
      transcript_path: transcriptPath,
      cwd: environment.workspacePath
    }),
    "utf8"
  )
  return payloadFile
}

describe("createHookCommand", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("is registered under a name that is not a Bash-allow-listed subcommand", () => {
    expect(createHookCommand().command).toBe(HookCommandName.hook)
    expect(HookCommandName.hook).toBe("hook")
  })

  it("prints nothing for a plan with no review", async () => {
    const transcriptPath = await writeTranscript(environment),
      payloadFile = await writePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json",
        transcriptPath
      ),
      result = await runCli(environment, ["hook", "--input", payloadFile])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })

  it("denies ExitPlanMode with the round protocol once a review is active", async () => {
    await runCliSetup(environment)

    const transcriptPath = await writeTranscript(environment),
      payloadFile = await writePayload(
        environment,
        "pre-tool-use-exit-plan-mode.json",
        transcriptPath
      ),
      result = await runCli(environment, ["hook", "--input", payloadFile])

    expect(result.exitCode).toBe(0)

    const { hookSpecificOutput } = JSON.parse(result.stdout)
    expect(hookSpecificOutput.hookEventName).toBe("PreToolUse")
    expect(hookSpecificOutput.permissionDecision).toBe(PermissionDecision.deny)
    expect(hookSpecificOutput.permissionDecisionReason).toContain(CliDocUrl)
    expect(hookSpecificOutput.permissionDecisionReason).toContain(
      "Google Doc review round"
    )
  })

  it("logs at error and stays silent when the payload cannot be read", async () => {
    await runCliSetup(environment)

    const result = await runCli(environment, [
      "hook",
      "--input",
      environment.workspacePath
    ])

    // Reading the payload is the one failure that cannot be answered in terms
    // of the event it belonged to — the event is spelled inside the payload —
    // so even a gated ExitPlanMode is answered with silence, and the log line
    // is the only trace of it.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")

    const text = await readFile(
      path.join(environment.statePath, Logger.FileName),
      "utf8"
    )
    expect(text).toContain(HookCommand.UnreadablePayloadMessage)
    expect(text).toContain(`"level":"error"`)
  })

  it("exits 0 and prints nothing for a malformed payload", async () => {
    const payloadFile = path.join(environment.workspacePath, "broken.json")
    await writeFile(payloadFile, "{not json", "utf8")

    const result = await runCli(environment, ["hook", "--input", payloadFile])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })

  it("exits 0 and prints nothing for a payload that is not a known hook event", async () => {
    const payloadFile = path.join(environment.workspacePath, "unknown.json")
    await writeFile(payloadFile, JSON.stringify({}), "utf8")

    const result = await runCli(environment, ["hook", "--input", payloadFile])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("exits 0 and prints nothing when the input file does not exist", async () => {
    const result = await runCli(environment, [
      "hook",
      "--input",
      path.join(environment.workspacePath, "absent.json")
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("denies a gated payload the strict parse refuses", async () => {
    await runCliSetup(environment)

    const transcriptPath = await writeTranscript(environment),
      broken = [
        // No transcript path at all: the strict parse fails, and the event is
        // still recognisably the one that must not be waved through.
        { transcript_path: undefined },
        // Wrongly typed fields Claude Code could introduce.
        { session_id: 42 },
        { tool_input: "ExitPlanMode" }
      ]

    for (const overrides of broken) {
      const payloadFile = path.join(environment.workspacePath, "broken.json")

      await writeFile(
        payloadFile,
        JSON.stringify({
          ...readHookFixture("pre-tool-use-exit-plan-mode.json"),
          session_id: HookSessionId,
          transcript_path: transcriptPath,
          cwd: environment.workspacePath,
          ...overrides
        }),
        "utf8"
      )

      const result = await runCli(environment, ["hook", "--input", payloadFile])

      expect(result.exitCode).toBe(0)
      expect(
        JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
      ).toBe(PermissionDecision.deny)
      expect(
        JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason
      ).toContain(ExitPlanModeGateHandler.FailureReason)
    }
  })

  it("handles a gated payload that carries no cwd", async () => {
    await runCliSetup(environment)

    const transcriptPath = await writeTranscript(environment),
      payloadFile = path.join(environment.workspacePath, "no-cwd.json"),
      { cwd, ...fixture } = readHookFixture("pre-tool-use-exit-plan-mode.json")

    expect(cwd).toBeDefined()
    await writeFile(
      payloadFile,
      JSON.stringify({
        ...fixture,
        session_id: HookSessionId,
        transcript_path: transcriptPath
      }),
      "utf8"
    )

    const result = await runCli(environment, ["hook", "--input", payloadFile])

    // `cwd` is optional, so this payload is handled normally: the gate denies
    // with the round protocol, not with the fail-closed reason.
    expect(result.exitCode).toBe(0)
    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason
    ).toContain(CliDocUrl)
  })

  it("stays silent when an ungated payload cannot be parsed", async () => {
    const payloads = [
      { hook_event_name: "PostToolUse", tool_name: "ExitPlanMode" },
      { hook_event_name: "PreToolUse", tool_name: "Bash" },
      { hook_event_name: "PreToolUse" },
      "not an object"
    ]

    for (const payload of payloads) {
      const payloadFile = path.join(environment.workspacePath, "ungated.json")

      await writeFile(payloadFile, JSON.stringify(payload), "utf8")

      const result = await runCli(environment, ["hook", "--input", payloadFile])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("")
    }
  })

  describe("HookCommand", () => {
    it("recognises the gated event on the raw payload alone", () => {
      expect(
        HookCommand.isGatedEvent({
          hook_event_name: "PreToolUse",
          tool_name: "ExitPlanMode",
          whatever: { the: "engine adds" }
        })
      ).toBe(true)
      expect(
        HookCommand.isGatedEvent({
          hook_event_name: "PostToolUse",
          tool_name: "ExitPlanMode"
        })
      ).toBe(false)
      expect(
        HookCommand.isGatedEvent({
          hook_event_name: "PreToolUse",
          tool_name: "Bash"
        })
      ).toBe(false)
      expect(HookCommand.isGatedEvent(null)).toBe(false)
      expect(HookCommand.isGatedEvent("PreToolUse")).toBe(false)
    })

    it("answers only the gated event with a deny", () => {
      const denied = HookCommand.newFailureOutputForRaw(true)

      expect(denied.hookSpecificOutput).toMatchObject({
        hookEventName: "PreToolUse",
        permissionDecision: PermissionDecision.deny
      })
      expect(HookCommand.newFailureOutputForRaw(false)).toBeNull()
    })

    it("names the log file of the state directory in use", () => {
      expect(HookCommand.resolveFailureLogFile()).toContain(Logger.FileName)
    })
  })

  it("prints nothing when stdin is a terminal", async () => {
    const { stdin } = process,
      wasTty = stdin.isTTY

    stdin.isTTY = true
    try {
      const result = await runCli(environment, ["hook"])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("")
    } finally {
      stdin.isTTY = wasTty
    }
  })
})
