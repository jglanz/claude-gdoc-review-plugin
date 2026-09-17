import {
  CliSubcommand,
  createInitCommand,
  createLogThreadCommand,
  createRegisterCommand,
  createStatusCommand,
  ShellUtils
} from "claude-gdoc-review-plugin"
import type { CommandModule } from "yargs"

/** The command factory of every auto-allowed subcommand, keyed by its name. */
const CommandFactoriesBySubcommand: Record<string, () => CommandModule> = {
  [CliSubcommand.init]: createInitCommand,
  [CliSubcommand.register]: createRegisterCommand,
  [CliSubcommand["log-thread"]]: createLogThreadCommand,
  [CliSubcommand.status]: createStatusCommand
}

function normalized(names: readonly string[]): string[] {
  return [...names].map(ShellUtils.normalizeFlagName).sort()
}

function optionNamesOf(subcommand: string): string[] {
  const { [subcommand]: createCommand } = CommandFactoriesBySubcommand
  return Object.keys(createCommand().builder)
}

/**
 * The Bash allow-list is only a closed set while it names every option its
 * subcommand offers. An option added to a command and to nothing else would
 * otherwise turn an ordinary invocation into a refusal (the flag is unknown) or,
 * worse, an option deliberately kept off the list would drift back onto it
 * unnoticed. Both tables are therefore asserted against the commands' own
 * definitions rather than against a copy of them.
 */
describe("Bash allow-list and CLI option parity", () => {
  it("covers every auto-allowed subcommand", () => {
    expect(Object.keys(CommandFactoriesBySubcommand).sort()).toEqual(
      Object.values(CliSubcommand).sort()
    )
  })

  it.each(Object.values(CliSubcommand))(
    "accounts for every option %s defines",
    subcommand => {
      const { [subcommand]: allowed = [] } =
          ShellUtils.AllowedFlagNamesBySubcommand,
        { [subcommand]: never = [] } =
          ShellUtils.NeverAllowedFlagNamesBySubcommand

      expect(normalized([...allowed, ...never])).toEqual(
        normalized(optionNamesOf(subcommand))
      )
    }
  )

  it.each(Object.values(CliSubcommand))(
    "never lists an option %s does not define",
    subcommand => {
      const { [subcommand]: allowed = [] } =
        ShellUtils.AllowedFlagNamesBySubcommand

      normalized(allowed).forEach(name =>
        expect(normalized(optionNamesOf(subcommand))).toContain(name)
      )
    }
  )

  it("keeps the deliberately excluded flags off the allow-list", () => {
    Object.entries(ShellUtils.NeverAllowedFlagNamesBySubcommand).forEach(
      ([subcommand, names]) => {
        const { [subcommand]: allowed = [] } =
          ShellUtils.AllowedFlagNamesBySubcommand

        normalized(names).forEach(name =>
          expect(normalized(allowed)).not.toContain(name)
        )
      }
    )
  })
})
