import "source-map-support/register.js"

import yargs from "yargs"
import type { Argv, ParserConfigurationOptions } from "yargs"

import { NestedError } from "../errors/index.js"
import { getLogger, writeStderr } from "../logging/index.js"
import {
  appendCliState,
  CliState,
  resolveCliStateDirectory
} from "./CliState.js"
import {
  createCancelCommand,
  createDecisionCommand,
  createHookCommand,
  createInitCommand,
  createLogThreadCommand,
  createReactivateCommand,
  createRegisterCommand,
  createStatusCommand,
  createSyncedCommand
} from "./commands/index.js"

/** Constants of the CLI entry point. */
export namespace Cli {
  /** Name the usage text and every error message is spelled with. */
  export const ScriptName = "gdoc-review"

  /** Usage line shown above the command list. */
  export const Usage =
    "$0 <command> [options] — Google Doc plan reviews for Claude Code"

  /** Trailing note shown under the command list. */
  export const Epilogue =
    "Review state lives in $CLAUDE_CONFIG_DIR/gdoc-review; diagnostics go to its log.jsonl."

  /** At least one command is always required; there is no default action. */
  export const MinimumCommandCount = 1

  /** Exit code of a command that completed. */
  export const SuccessExitCode = 0

  /** Exit code of a command that failed; `hook` never uses it. */
  export const FailureExitCode = 1

  /** Prefix of the one-line failure message written to stderr. */
  export const FailureMessagePrefix = `${ScriptName}:`

  /** Line terminator of the failure message. */
  export const LineSeparator = "\n"

  /** Lead-in of the wrapper built for a parser failure that carries no error. */
  export const ParserFailureMessage = "Command line rejected:"

  /**
   * Parser settings that make every option have exactly one accepted spelling.
   *
   * yargs otherwise registers a camelCase alias for each hyphenated option, so
   * `--state-dir` would also answer to `--stateDir` — a second spelling the
   * PreToolUse flag allow-list would have to know about. With the expansion off
   * and aliases stripped, `.strict()` rejects the camelCase form outright and
   * the allow-list has one name per flag to compare.
   */
  export const ParserConfiguration: Partial<ParserConfigurationOptions> = {
    "camel-case-expansion": false,
    "strip-aliased": true
  }
}

function assertParsed(message: string, cause: Error): never {
  throw cause == null
    ? new NestedError(`${Cli.ParserFailureMessage} ${message}`, {
        context: { message }
      })
    : cause
}

/**
 * Builds the fully configured yargs parser: every command is a
 * `create<Name>Command()` factory registered with `.command()`, and routing is
 * the framework's own (`STYLE.md` §15) — there is no dispatch table on top.
 *
 * The parser never exits the process itself, so `main` owns the exit code and
 * an embedding test can run it repeatedly.
 *
 * @param argv Command-line arguments, without the node and script entries.
 * @returns The parser, ready for `parseAsync()`.
 */
export function createCliParser(argv: string[]): Argv {
  const parser: Argv = yargs(argv)
    .parserConfiguration(Cli.ParserConfiguration)
    .scriptName(Cli.ScriptName)
    .usage(Cli.Usage)
    .epilogue(Cli.Epilogue)
    .option(
      CliState.StateDirectoryOption,
      CliState.StateDirectoryOptionDefinition
    )

  return parser
    .middleware(appendCliState)
    .command(createInitCommand())
    .command(createRegisterCommand())
    .command(createLogThreadCommand())
    .command(createDecisionCommand())
    .command(createSyncedCommand())
    .command(createStatusCommand())
    .command(createCancelCommand())
    .command(createReactivateCommand())
    .command(createHookCommand())
    .demandCommand(Cli.MinimumCommandCount)
    .strict()
    .help()
    .version(false)
    .exitProcess(false)
    .fail(assertParsed)
}

/**
 * Runs one CLI invocation.
 *
 * A failure is reported on stderr and through the file log, and answered with
 * a non-zero exit code — stdout stays clean, because it carries the CLI and
 * hook protocol output and nothing else.
 *
 * The failure logger is made here rather than at module scope: `--state-dir` is
 * parsed by the middleware, so the directory the invocation works against is
 * only known once the parser has run, and that is the directory whose
 * `log.jsonl` the operator will read.
 *
 * @param argv Command-line arguments; defaults to this process's own.
 * @returns The exit code the caller should leave the process with.
 */
export async function main(
  argv: string[] = process.argv.slice(2)
): Promise<number> {
  try {
    await createCliParser(argv).parseAsync()
    return Cli.SuccessExitCode
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause),
      log = getLogger(__filename, {
        stateDirectory: resolveCliStateDirectory()
      })

    log.error("%s %s", Cli.FailureMessagePrefix, message)
    writeStderr(`${Cli.FailureMessagePrefix} ${message}${Cli.LineSeparator}`)
    return Cli.FailureExitCode
  }
}

// Self-start only when this module IS the process entry point. `bin/gdoc-review`
// requires the bundle and calls `main()` itself, and a test that imports the
// module gets the parser without running it.
if (require.main === module) {
  void main().then(code => {
    process.exitCode = code
  })
}
