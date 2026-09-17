import type { CommandModule, Options } from "yargs"

import type { ReviewState } from "../../state/index.js"
import { ReviewStatus } from "../../state/index.js"
import { GatedCliSubcommand } from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import { createCliStore } from "../CliState.js"
import {
  assertReviewState,
  PlanOptionDefinition,
  printReviewState,
  resolvePlanFile
} from "../commandSupport.js"

/** Arguments of the `cancel` command. */
export interface CancelCommandArguments extends CliState.Arguments {
  /** Plan markdown file the review is keyed by. */
  plan: string
}

/** Constants of the `cancel` command. */
export namespace CancelCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Stop gating this plan: the built-in approval dialog comes back"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: PlanOptionDefinition
  }
}

/**
 * Builds the `cancel` command.
 *
 * A cancelled review keeps its Doc, its revision history and its comment
 * bookkeeping — only the status changes, and the `ExitPlanMode` gate goes
 * silent, so the session behaves as if the plugin were not installed.
 * {@link createReactivateCommand} is the way back.
 *
 * Silencing the gate is exactly what the gate exists to prevent a model from
 * doing on its own, so this command is never auto-allowed through Bash
 * ({@link GatedCliSubcommand}): running it always asks the user first.
 *
 * @returns The yargs command module.
 */
export function createCancelCommand(): CommandModule<
  CliState.Arguments,
  CancelCommandArguments
> {
  return {
    command: GatedCliSubcommand.cancel,
    describe: CancelCommand.Description,
    builder: CancelCommand.OptionDefinitions,
    handler: async argv => {
      const planFile = resolvePlanFile(argv.plan),
        store = await createCliStore(),
        state = await assertReviewState(store, planFile),
        next: ReviewState = { ...state, status: ReviewStatus.cancelled }

      await store.save(next)
      printReviewState(next)
    }
  }
}
