import { homedir } from "node:os"
import path from "node:path"

import { defaults } from "lodash"
import { z } from "zod"

import { GDocReview } from "../Constants.js"
import { getLogger } from "../logging/logger.js"
import { LogLevel } from "../logging/LogLevel.js"
import { PermissionMode, SyncMode } from "../state/ReviewStateEnums.js"
import {
  getValue,
  isNonEmptyString,
  readTextFileOrNull
} from "../utils/index.js"

/**
 * Permission mode entered when the user picks "Approve and Use Auto Mode".
 *
 * This key is security-relevant: it names the mode the plugin switches the
 * session into in place of the built-in approval dialog, so `auto` is opt-in
 * and falls back to `acceptEdits` whenever the prompt does not offer it.
 */
export enum ApproveAutoMode {
  acceptEdits = "acceptEdits",
  auto = "auto"
}

/**
 * Maps the configured "Approve and Use Auto Mode" setting onto the permission
 * mode that menu row asks for, before the permission prompt's own offer can
 * narrow it.
 *
 * It is the single source of that mapping: the menu row's description names the
 * mode it resolves to, the decision-capture hook rebuilds the same description
 * to recognise the menu, and the permission hook starts from it before checking
 * what the prompt offers. A row that says one thing and a hook that expects
 * another is a menu whose answer is silently dropped.
 *
 * @param approveAutoMode Configured mode for option 1 of the review menu.
 * @returns The permission mode that row requests.
 */
export function resolveApproveAutoPermissionMode(
  approveAutoMode: ApproveAutoMode
): PermissionMode {
  return approveAutoMode === ApproveAutoMode.auto
    ? PermissionMode.auto
    : PermissionMode.acceptEdits
}

/** What the caller may override; every field falls back to file, env, then default. */
export interface PluginConfigOptions {
  /** Permission mode requested for option 1 of the approval menu. */
  approveAutoMode?: ApproveAutoMode

  /** How the plan text reaches the Doc: inline content or a server-readable path. */
  syncMode?: SyncMode

  /** Prefix marking a Doc comment as written by the agent. */
  replyPrefix?: string

  /** Minimum level written to the JSON-lines log. */
  logLevel?: LogLevel
}

/** Fully resolved configuration: every option present. */
export interface PluginConfig extends Required<PluginConfigOptions> {}

/** What {@link resolvePluginConfig} accepts: the overrides plus where to read the file from. */
export interface PluginConfigResolveOptions extends PluginConfigOptions {
  /**
   * State directory whose `config.json` is read; defaults to the
   * environment-resolved one. The CLI passes what `--state-dir` named and the
   * hook path passes its context's directory, so the file is always read from
   * the directory the caller actually works against.
   */
  stateDirectory?: string
}

/** Validator of `config.json` and of the `GDOC_REVIEW_*` environment overrides. */
export const PluginConfigFileSchema = z.object({
  approveAutoMode: z.enum(ApproveAutoMode).optional(),
  syncMode: z.enum(SyncMode).optional(),
  replyPrefix: z.string().min(1).optional(),
  logLevel: z.enum(LogLevel).optional()
})

/** Shape accepted in `config.json`; every key is optional. */
export type PluginConfigFile = z.infer<typeof PluginConfigFileSchema>

/**
 * State directory the running invocation works against, when it is not the
 * environment-resolved one. The CLI middleware sets it from `--state-dir`
 * before any command runs, so a module that resolves its logger late — with no
 * store and no context to ask — still writes into the directory this
 * invocation reads and writes.
 */
let activeStateDirectory: string = null

/**
 * Points every late-bound resolution at one state directory, or back at the
 * environment.
 *
 * @param stateDirectory Directory the invocation works against, or `null` to
 *   fall back to {@link PluginConfig.ConfigDirectoryEnvironmentKey}.
 */
export function setActiveStateDirectory(stateDirectory: string): void {
  activeStateDirectory = isNonEmptyString(stateDirectory)
    ? stateDirectory
    : null
}

/**
 * Resolves the directory holding `reviews/`, `sessions/`, `config.json` and
 * `log.jsonl`: whatever {@link setActiveStateDirectory} last named, else the
 * Claude config directory (`CLAUDE_CONFIG_DIR`, else `~/.claude`) joined with
 * the plugin's own directory name.
 *
 * The override is what keeps a `--state-dir` run out of the real
 * `~/.claude/gdoc-review`: the diagnostic log of a module that has no store to
 * ask — the plan digest, the plugin-root resolver — would otherwise land
 * beside state the invocation never touched.
 *
 * @returns Absolute path of the plugin state directory. The directory is not
 *   created here; writers create it on demand.
 */
export function resolveStateDirectory(): string {
  if (isNonEmptyString(activeStateDirectory)) {
    return activeStateDirectory
  }

  const { [PluginConfig.ConfigDirectoryEnvironmentKey]: configuredDirectory } =
      process.env,
    baseDirectoryPath = isNonEmptyString(configuredDirectory)
      ? configuredDirectory
      : path.join(homedir(), PluginConfig.ClaudeConfigDirectoryName)

  return path.join(baseDirectoryPath, GDocReview.StateDirName)
}

/**
 * Builds the lowest layer of the configuration.
 *
 * @returns The defaults, taken from the companion namespace's constants.
 */
export function createPluginConfigDefaultOptions(): PluginConfigOptions {
  return {
    approveAutoMode: PluginConfig.DefaultApproveAutoMode,
    syncMode: PluginConfig.DefaultSyncMode,
    replyPrefix: GDocReview.ReplyPrefix,
    logLevel: PluginConfig.DefaultLogLevel
  }
}

/** Sentinel distinguishing "the JSON did not parse" from a document that is literally `null`. */
const UnparsedConfigValue = Symbol("gdoc-review.unparsedConfig")

function readValidCandidate(
  candidate: unknown,
  source: string,
  stateDirectory: string
): PluginConfigFile {
  const result = PluginConfigFileSchema.safeParse(candidate)
  if (result.success) {
    return result.data
  }

  getLogger(__filename, { stateDirectory }).warn(
    "%s %s: %s",
    PluginConfig.DegradedConfigMessage,
    source,
    result.error.message
  )
  return {}
}

function readJsonOrNull(
  text: string,
  file: string,
  stateDirectory: string
): unknown {
  const parsed = getValue<unknown>(() => JSON.parse(text), UnparsedConfigValue)
  if (parsed !== UnparsedConfigValue) {
    return parsed
  }

  getLogger(__filename, { stateDirectory }).warn(
    "%s %s: not valid JSON",
    PluginConfig.DegradedConfigMessage,
    file
  )
  return {}
}

async function readPluginConfigFile(
  stateDirectory: string
): Promise<PluginConfigFile> {
  const file = path.join(stateDirectory, PluginConfig.ConfigFileName),
    text = await readTextFileOrNull(file)

  return isNonEmptyString(text)
    ? readValidCandidate(
        readJsonOrNull(text, file, stateDirectory),
        file,
        stateDirectory
      )
    : {}
}

function appendEnvironmentOption(
  options: PluginConfigFile,
  key: string,
  variable: string,
  stateDirectory: string
): PluginConfigFile {
  const { [variable]: value } = process.env
  if (!isNonEmptyString(value)) {
    return options
  }

  return {
    ...options,
    ...readValidCandidate(
      { [key]: value },
      PluginConfig.newEnvironmentSourceName(variable),
      stateDirectory
    )
  }
}

/**
 * Reads the `GDOC_REVIEW_*` overrides, validating each variable on its own.
 *
 * One bogus variable used to discard the whole environment layer, so
 * `GDOC_REVIEW_SYNC_MODE=telepathy` silently took `GDOC_REVIEW_LOG_LEVEL=debug`
 * down with it — and the log level is what the operator sets to find out why.
 * Each key is now validated by itself: the valid ones apply, and every rejected
 * one is reported at `warn` naming the variable that was ignored.
 */
function readPluginConfigEnvironment(stateDirectory: string): PluginConfigFile {
  return Object.entries(PluginConfig.EnvironmentVariableByOption).reduce(
    (options: PluginConfigFile, [key, variable]) =>
      appendEnvironmentOption(options, key, variable, stateDirectory),
    {}
  )
}

/**
 * Resolves the plugin configuration from, in decreasing precedence: the
 * caller's options, the `GDOC_REVIEW_*` environment variables, `config.json`
 * in the state directory, and the built-in defaults.
 *
 * A missing `config.json` is normal, and a malformed one — or an environment
 * variable naming a value its key does not accept — degrades to the defaults
 * with a warning rather than failing. The environment layer degrades one
 * variable at a time, so a rejected value never takes the other variables of
 * the same run with it. Degrading rather than failing is deliberate even though
 * `approveAutoMode` is security-relevant — it picks the permission mode the
 * plugin switches the session into without the built-in dialog: a value the
 * schema refuses falls back to the narrower default, while failing the hook
 * would take the `ExitPlanMode` gate down with it and let the plan through
 * unreviewed.
 *
 * @param options Caller overrides and the state directory to read; every field
 *   optional.
 * @returns The fully resolved configuration.
 */
export async function resolvePluginConfig(
  options?: PluginConfigResolveOptions
): Promise<PluginConfig> {
  const { stateDirectory = resolveStateDirectory(), ...overrides } =
      options ?? {},
    fileOptions = await readPluginConfigFile(stateDirectory),
    environmentOptions = readPluginConfigEnvironment(stateDirectory)

  return defaults(
    { ...overrides },
    environmentOptions,
    fileOptions,
    createPluginConfigDefaultOptions()
  ) as PluginConfig
}

/** Constants of {@link PluginConfig}. */
export namespace PluginConfig {
  /** Name of the configuration document inside the state directory. */
  export const ConfigFileName = "config.json"

  /** Directory Claude Code uses for its configuration when the env var is unset. */
  export const ClaudeConfigDirectoryName = ".claude"

  /** Environment variable relocating the Claude config directory. */
  export const ConfigDirectoryEnvironmentKey = "CLAUDE_CONFIG_DIR"

  /** Environment variable overriding {@link PluginConfigOptions.approveAutoMode}. */
  export const ApproveModeEnvironmentKey = "GDOC_REVIEW_APPROVE_MODE"

  /** Environment variable overriding {@link PluginConfigOptions.syncMode}. */
  export const SyncModeEnvironmentKey = "GDOC_REVIEW_SYNC_MODE"

  /** Environment variable overriding {@link PluginConfigOptions.replyPrefix}. */
  export const ReplyPrefixEnvironmentKey = "GDOC_REVIEW_REPLY_PREFIX"

  /** Environment variable overriding {@link PluginConfigOptions.logLevel}. */
  export const LogLevelEnvironmentKey = "GDOC_REVIEW_LOG_LEVEL"

  /** Source label used when an environment override fails validation. */
  export const EnvironmentSourceName = "environment"

  /**
   * The environment variable overriding each configuration key. It is the one
   * place the mapping exists, so a key is validated, reported and applied under
   * the name the operator actually set.
   */
  export const EnvironmentVariableByOption: Readonly<Record<string, string>> = {
    approveAutoMode: ApproveModeEnvironmentKey,
    syncMode: SyncModeEnvironmentKey,
    replyPrefix: ReplyPrefixEnvironmentKey,
    logLevel: LogLevelEnvironmentKey
  }

  /**
   * Names one rejected environment variable in the degradation warning.
   *
   * @param variable Environment variable whose value was refused.
   * @returns The source label the warning quotes.
   */
  export function newEnvironmentSourceName(variable: string): string {
    return `${EnvironmentSourceName} ${variable}`
  }

  /** Lead-in of the warning logged when a configuration source is ignored. */
  export const DegradedConfigMessage = "Ignoring the plugin configuration from"

  /**
   * Default of {@link PluginConfigOptions.approveAutoMode}: the narrower of the
   * two modes, and one the permission prompt always offers.
   */
  export const DefaultApproveAutoMode = ApproveAutoMode.acceptEdits

  /** Default of {@link PluginConfigOptions.syncMode}: inline content needs no server file access. */
  export const DefaultSyncMode = SyncMode.content

  /** Default of {@link PluginConfigOptions.logLevel}. */
  export const DefaultLogLevel = LogLevel.info
}
