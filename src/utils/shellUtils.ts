import Assert from "node:assert"

import { isNonEmptyString } from "./typeUtils.js"

/** The `gdoc-review` subcommands the PreToolUse Bash gate may auto-allow. */
export enum CliSubcommand {
  init = "init",
  register = "register",
  "log-thread" = "log-thread",
  status = "status"
}

/**
 * The `gdoc-review` subcommands the Bash gate never auto-allows: each one
 * writes a field the gate reads (`status`, `lastSync`, `decision`).
 *
 * `decision` and `synced` write the recorded approval and the recorded sync
 * digest, which are exactly what the `ExitPlanMode` gate and the
 * `PermissionRequest` hook trust. `cancel` and `reactivate` write the status
 * the gate switches on: `cancel` silences it outright, and `reactivate` re-arms
 * a closed review. A model that could run any of them through an auto-allowed
 * Bash call could put the plan past the review the user asked for, without the
 * user ever seeing a prompt.
 *
 * They stay registered on the CLI — they are the documented recovery path — but
 * always go through the user's normal Bash permission prompt, on the same
 * principle as the `hook` entry point, which the allow-list also refuses.
 */
export enum GatedCliSubcommand {
  decision = "decision",
  synced = "synced",
  cancel = "cancel",
  reactivate = "reactivate"
}

/** Verdict of the Bash allow-list on a single candidate command line. */
export interface CliAllowlistMatch {
  /** `true` only when the command is exactly one plain invocation of an allowed subcommand. */
  allowed: boolean

  /** The matched subcommand, or `null` when the command was rejected. */
  subcommand: string

  /** Value of the command's `--plan` flag, or `null` when it carries none. */
  planFile: string
}

/** Tests one command line against the allow-list built by {@link createCliAllowlistMatcher}. */
export type CliAllowlistMatcher = (command: string) => CliAllowlistMatch

/** Constants of the Bash allow-list. */
export namespace ShellUtils {
  /**
   * Shell metacharacters that turn a single invocation into something else.
   * A command containing any of them is rejected outright, so the allow-list
   * can never be used as a springboard (`… status ; rm -rf ~`).
   */
  export const ForbiddenShellExpression = /[;|&`<>\n\r]|\$\(/

  /** Reads the `--plan` flag in `--plan X`, `--plan=X`, `--plan "X"` and `--plan 'X'` form. */
  export const PlanFlagExpression =
    /--plan(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/

  /** Reads the name of every long flag in a command line. */
  export const LongFlagNameExpression = /--([^\s=]+)/g

  /** Characters a flag name may be spelled with that carry no meaning. */
  export const FlagNameSeparatorExpression = /[-_]/g

  /**
   * The long flags each auto-allowed subcommand may carry — an allow-list, so
   * a flag this table does not name is a rejection rather than something the
   * gate has to have anticipated.
   *
   * It is what keeps an auto-allowed call inside the state directory the hooks
   * themselves read: `--state-dir` is on no subcommand's list, so a command
   * that repoints the CLI cannot seed a review document somewhere the user
   * never inspects and later have it trusted. Comparison goes through
   * {@link normalizeFlagName}, so the alternate spellings a parser might
   * accept (`--stateDir`, `--state_dir`, `--STATE-DIR`) are the same foreign
   * name and are refused with it.
   */
  export const AllowedFlagNamesBySubcommand: Readonly<
    Record<string, readonly string[]>
  > = {
    [CliSubcommand.init]: ["plan", "kind", "drive-name", "path"],
    [CliSubcommand.register]: [
      "plan",
      "doc-id",
      "doc-url",
      "folder-id",
      "drive-id",
      "server",
      "sync-mode"
    ],
    [CliSubcommand["log-thread"]]: ["plan", "comment-id"],
    [CliSubcommand.status]: ["plan", "json"]
  }

  /**
   * The flags a subcommand offers that the gate nevertheless never
   * auto-allows — the deliberate gap between a command's options and its entry
   * in {@link AllowedFlagNamesBySubcommand}.
   *
   * `init --force` replaces the review of a plan that already has one, throwing
   * away the Doc id, the revision history and the recorded approval with it.
   * Re-running `/gdoc-review` over an existing review is a decision for the
   * user, so the flag stays on the CLI and always asks at the Bash prompt.
   *
   * Every other option of every auto-allowed subcommand is on that subcommand's
   * allow-list; the two tables together are asserted against the commands' own
   * option definitions, so a new option cannot be added without landing in one
   * of them.
   */
  export const NeverAllowedFlagNamesBySubcommand: Readonly<
    Record<string, readonly string[]>
  > = {
    [CliSubcommand.init]: ["force"]
  }

  /**
   * Reduces a flag name to the form the allow-list compares: lower case, with
   * every separator removed.
   *
   * @param name Flag name as the command line spelled it, without `--`.
   * @returns The comparable name.
   */
  export function normalizeFlagName(name: string): string {
    return String(name).toLowerCase().replace(FlagNameSeparatorExpression, "")
  }

  /**
   * Reads the long flag names a command line carries.
   *
   * @param command The candidate command line.
   * @returns Every `--name`, normalized, in the order they appear.
   */
  export function readLongFlagNames(command: string): string[] {
    return Array.from(command.matchAll(LongFlagNameExpression), ([, name]) =>
      normalizeFlagName(name)
    )
  }

  /**
   * Reports whether every long flag of a command is on its subcommand's list.
   *
   * @param command The candidate command line.
   * @param subcommand The matched subcommand.
   * @returns `true` when the subcommand is known and carries only its own flags.
   */
  export function hasOnlyAllowedFlags(
    command: string,
    subcommand: string
  ): boolean {
    const { [subcommand]: allowedNames } = AllowedFlagNamesBySubcommand
    if (allowedNames == null) {
      return false
    }

    const allowed = new Set(allowedNames.map(normalizeFlagName))
    return readLongFlagNames(command).every(name => allowed.has(name))
  }
}

const RegExpMetacharacterExpression = /[.*+?^${}()|[\]\\]/g

function escapeForRegExp(text: string): string {
  return text.replace(RegExpMetacharacterExpression, "\\$&")
}

function createRejection(): CliAllowlistMatch {
  return { allowed: false, subcommand: null, planFile: null }
}

function readPlanFile(command: string): string {
  const flagMatch = ShellUtils.PlanFlagExpression.exec(command)
  if (flagMatch === null) {
    return null
  }
  const [, doubleQuoted, singleQuoted, bare] = flagMatch
  return doubleQuoted || singleQuoted || bare || null
}

/**
 * Builds the matcher the PreToolUse Bash hook uses to auto-allow this plugin's
 * own CLI calls and nothing else.
 *
 * A command is allowed only when it is, from its first non-blank character, an
 * optional `node`, one of the given absolute script paths (optionally
 * double-quoted), and an allowed subcommand terminated by whitespace or the end
 * of the line — and when it carries no shell metacharacter and no long flag
 * outside that subcommand's entry in
 * {@link ShellUtils.AllowedFlagNamesBySubcommand}. The subcommands that write
 * the state the gate trusts ({@link GatedCliSubcommand}) are not in the
 * alternation at all.
 *
 * @param scriptFiles Absolute paths of the launchers that may be invoked
 *   (the committed bundle and the `bin/` launcher).
 * @returns A matcher over candidate command lines.
 */
export function createCliAllowlistMatcher(
  scriptFiles: string[]
): CliAllowlistMatcher {
  Assert.ok(
    Array.isArray(scriptFiles) &&
      scriptFiles.every(isNonEmptyString) &&
      scriptFiles.length > 0,
    "createCliAllowlistMatcher requires at least one script path"
  )

  const scriptPattern = scriptFiles.map(escapeForRegExp).join("|"),
    subcommandPattern = Object.values(CliSubcommand).join("|"),
    commandExpression = new RegExp(
      `^\\s*(?:node\\s+)?"?(?:${scriptPattern})"?\\s+(${subcommandPattern})(?=\\s|$)`
    )

  return (command: string): CliAllowlistMatch => {
    if (
      !isNonEmptyString(command) ||
      ShellUtils.ForbiddenShellExpression.test(command)
    ) {
      return createRejection()
    }

    const commandMatch = commandExpression.exec(command)
    if (commandMatch === null) {
      return createRejection()
    }

    const [, subcommand] = commandMatch
    if (!ShellUtils.hasOnlyAllowedFlags(command, subcommand)) {
      return createRejection()
    }
    return { allowed: true, subcommand, planFile: readPlanFile(command) }
  }
}
