import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import {
  CliState,
  CliSubcommand,
  GatedCliSubcommand,
  CommandSupport,
  GDocReview,
  HookCommandName,
  Logger,
  LogLevel,
  PluginConfig
} from "claude-gdoc-review-plugin"
import { Cli, createCliParser, main } from "claude-gdoc-review-plugin/cli/index"

import type { CliTestEnvironment } from "../support/cliTestSupport.js"
import {
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli
} from "../support/cliTestSupport.js"

interface CapturedRun {
  /** Exit code `main()` returned. */
  exitCode: number

  /** Everything the invocation wrote to stdout. */
  stdout: string

  /** Everything the invocation wrote to stderr. */
  stderr: string
}

async function captureMain(args: string[]): Promise<CapturedRun> {
  const chunks: string[] = [],
    errorChunks: string[] = [],
    outSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        chunks.push(String(chunk))
        return true
      }),
    errorSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        errorChunks.push(String(chunk))
        return true
      })

  try {
    const exitCode = await main(args)
    return {
      exitCode,
      stdout: chunks.join(""),
      stderr: errorChunks.join("")
    }
  } finally {
    outSpy.mockRestore()
    errorSpy.mockRestore()
  }
}

describe("createCliParser", () => {
  it("names the script after the launcher", () => {
    expect(Cli.ScriptName).toBe("gdoc-review")
    expect(createCliParser([])).not.toBeNull()
  })

  it("registers every command, and the hook entry point alongside them", async () => {
    const help = await createCliParser([]).getHelp(),
      commandNames = [
        ...Object.values(CliSubcommand),
        ...Object.values(GatedCliSubcommand),
        HookCommandName.hook
      ]

    commandNames.forEach(name => {
      expect(help).toContain(`${Cli.ScriptName} ${name}`)
    })
    expect(help).toContain(`--${CliState.StateDirectoryOption}`)
  })
})

describe("main", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("succeeds on --help without touching stderr", async () => {
    const result = await captureMain(["--help"])

    expect(result.exitCode).toBe(Cli.SuccessExitCode)
    expect(result.stderr).toBe("")
  })

  it("rejects an unknown command", async () => {
    const result = await captureMain(["bogus"])

    expect(result.exitCode).toBe(Cli.FailureExitCode)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(Cli.ParserFailureMessage)
    expect(result.stderr).toContain("bogus")
  })

  it("rejects an invocation with no command at all", async () => {
    const result = await captureMain([])

    expect(result.exitCode).toBe(Cli.FailureExitCode)
    expect(result.stdout).toBe("")
  })

  it("rejects an unknown option on a known command", async () => {
    const result = await runCli(environment, ["status", "--not-an-option"])

    expect(result.exitCode).toBe(Cli.FailureExitCode)
    expect(result.stderr).toContain("not-an-option")
  })

  it("registers no camelCase alias for a hyphenated option", async () => {
    const result = await runCli(environment, [
      "status",
      "--stateDir",
      environment.statePath
    ])

    expect(result.exitCode).toBe(Cli.FailureExitCode)
    expect(result.stderr).toContain("stateDir")
    expect(Cli.ParserConfiguration).toEqual({
      "camel-case-expansion": false,
      "strip-aliased": true
    })
  })

  it("logs a failure into the state directory --state-dir named", async () => {
    const result = await runCli(environment, [
      "status",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(Cli.FailureExitCode)

    const text = await readFile(
      path.join(environment.statePath, Logger.FileName),
      "utf8"
    )

    // Diagnostics belong next to the state the invocation worked against, and
    // that is also the file the fail-closed deny tells the user to read.
    expect(text).toContain("No review state for")
    expect(text).toContain(environment.planFile)
  })

  it("rejects a command line repeating --plan", async () => {
    const result = await runCli(environment, [
      "status",
      "--plan",
      environment.planFile,
      "--plan",
      environment.planFile
    ])

    // yargs collects the repetition into an array; the PreToolUse Bash gate
    // reads only the first one and allows the call, so the CLI is where a
    // second --plan has to stop.
    expect(result.exitCode).toBe(Cli.FailureExitCode)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(CommandSupport.RepeatedPlanFileMessage)
  })

  it("keeps its diagnostics inside the directory --state-dir named", async () => {
    const originalLevel =
        process.env[PluginConfig.LogLevelEnvironmentKey] ?? null,
      environmentLogFile = path.join(
        process.env[PluginConfig.ConfigDirectoryEnvironmentKey],
        GDocReview.StateDirName,
        Logger.FileName
      ),
      sizeOf = async (file: string): Promise<number> => {
        try {
          return (await stat(file)).size
        } catch {
          return -1
        }
      },
      sizeBefore = await sizeOf(environmentLogFile)

    process.env[PluginConfig.LogLevelEnvironmentKey] = LogLevel.debug
    try {
      // `status --plan` on a plan with no review logs the store's own `debug`
      // line and then the failure; both belong beside the state it read.
      await runCli(environment, ["status", "--plan", environment.planFile])
    } finally {
      if (originalLevel == null) {
        delete process.env[PluginConfig.LogLevelEnvironmentKey]
      } else {
        process.env[PluginConfig.LogLevelEnvironmentKey] = originalLevel
      }
    }

    const stateDirectoryLog = await readFile(
      path.join(environment.statePath, Logger.FileName),
      "utf8"
    )

    expect(stateDirectoryLog).toContain("No review state at")
    expect(await sizeOf(environmentLogFile)).toBe(sizeBefore)
  })

  it("routes a known command and leaves stderr clean", async () => {
    const result = await runCli(environment, ["status"])

    expect(result.exitCode).toBe(Cli.SuccessExitCode)
    expect(result.stderr).toBe("")
    expect(result.stdout.length).toBeGreaterThan(0)
  })
})
