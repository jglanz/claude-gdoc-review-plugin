import path from "node:path"

import type { ArgumentsCamelCase, Options } from "yargs"

import {
  resolveStateDirectory,
  setActiveStateDirectory
} from "../config/index.js"
import type { HookContext } from "../hooks/index.js"
import { ReviewStateStore } from "../state/index.js"
import { isNonEmptyString } from "../utils/index.js"

/**
 * Cross-cutting values every command shares, parsed once by the CLI middleware
 * (`STYLE.md` §15). Commands read this object instead of threading globals
 * through every handler signature.
 */
export interface CliState {
  /**
   * Plugin state directory named by `--state-dir`, already made absolute;
   * `null` means "resolve it from the environment" the way the hooks do. It
   * carries the review documents, the sessions cache, `config.json` and
   * `log.jsonl` — everything the invocation reads and writes.
   */
  stateDirectory: string
}

/** The one CLI state instance, populated by {@link appendCliState}. */
export const cliState: CliState = { stateDirectory: null }

/** Constants and sub-types of {@link cliState}. */
export namespace CliState {
  /** Name of the global option overriding the state directory. */
  export const StateDirectoryOption = "state-dir"

  /** Definition of {@link CliState.StateDirectoryOption}, shared by every command. */
  export const StateDirectoryOptionDefinition: Options = {
    type: "string",
    describe:
      "Plugin state directory: reviews/, sessions/ and the config.json and log.jsonl this invocation reads and writes (default: $CLAUDE_CONFIG_DIR/gdoc-review)",
    global: true
  }

  /** The parsed globals the middleware reads. */
  export interface Arguments {
    /**
     * Value of `--state-dir`, as the user typed it. The key is the option's own
     * spelling: the parser registers no camelCase alias
     * (`Cli.ParserConfiguration`), so `argv.stateDir` does not exist.
     */
    "state-dir"?: string
  }
}

/**
 * yargs middleware: copies the parsed globals into {@link cliState}, and points
 * the shared late-bound resolution at the same directory.
 *
 * The second half is what keeps a `--state-dir` invocation self-contained: a
 * module that resolves its logger on the fly and has no store to ask — the plan
 * digest, the plugin-root resolver — reads
 * {@link resolveStateDirectory}, so without this the diagnostics of an
 * invocation working against `X` would still land in the real
 * `$CLAUDE_CONFIG_DIR/gdoc-review/log.jsonl`.
 *
 * @param argv The parsed arguments of whichever command is running.
 */
export function appendCliState(argv: ArgumentsCamelCase): void {
  const { [CliState.StateDirectoryOption]: stateDir } = argv
  cliState.stateDirectory = isNonEmptyString(stateDir)
    ? path.resolve(stateDir)
    : null
  setActiveStateDirectory(cliState.stateDirectory)
}

/**
 * Returns {@link cliState} to its pre-parse values.
 *
 * Module-level state outlives a single `main()` call, so tests — and any caller
 * that runs the parser twice in one process — reset it between runs.
 */
export function resetCliState(): void {
  cliState.stateDirectory = null
  setActiveStateDirectory(null)
}

/**
 * Resolves the state directory a command works against.
 *
 * @returns The `--state-dir` value when one was given, otherwise the directory
 *   resolved from `CLAUDE_CONFIG_DIR`.
 */
export function resolveCliStateDirectory(): string {
  const { stateDirectory } = cliState
  return isNonEmptyString(stateDirectory)
    ? stateDirectory
    : resolveStateDirectory()
}

/**
 * Builds the store options matching {@link cliState}.
 *
 * The key is omitted rather than set to `null` when no override was given, so
 * the store's own default resolution runs.
 *
 * @returns Options for {@link ReviewStateStore.create}.
 */
export function createCliStoreOptions(): ReviewStateStore.Options {
  const { stateDirectory } = cliState
  return isNonEmptyString(stateDirectory) ? { stateDirectory } : {}
}

/**
 * Builds the hook-context options matching {@link cliState}.
 *
 * @returns Options for `createHookContext`.
 */
export function createCliHookContextOptions(): HookContext.Options {
  const { stateDirectory } = cliState
  return isNonEmptyString(stateDirectory) ? { stateDirectory } : {}
}

/**
 * Opens the state store a command reads and writes.
 *
 * @returns The store, with its sub-directories ensured.
 */
export async function createCliStore(): Promise<ReviewStateStore> {
  return await ReviewStateStore.create(createCliStoreOptions())
}
