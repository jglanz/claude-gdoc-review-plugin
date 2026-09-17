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

/** Arguments of the `reactivate` command. */
export interface ReactivateCommandArguments extends CliState.Arguments {
  /** Plan markdown file the review is keyed by. */
  plan: string
}

/** Constants of the `reactivate` command. */
export namespace ReactivateCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Gate this plan again, discarding the recorded approval decision"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: PlanOptionDefinition
  }
}

/**
 * Builds the `reactivate` command: the way back from `cancelled` or
 * `approved`.
 *
 * The recorded decision is dropped along with the status change, because an
 * approval given for an earlier round must never carry over into the new one —
 * the gate would otherwise let the very next `ExitPlanMode` through.
 *
 * It re-arms a review the user closed, so it is never auto-allowed through Bash
 * ({@link GatedCliSubcommand}): running it always asks the user first.
 *
 * @returns The yargs command module.
 */
export function createReactivateCommand(): CommandModule<
  CliState.Arguments,
  ReactivateCommandArguments
> {
  return {
    command: GatedCliSubcommand.reactivate,
    describe: ReactivateCommand.Description,
    builder: ReactivateCommand.OptionDefinitions,
    handler: async argv => {
      const planFile = resolvePlanFile(argv.plan),
        store = await createCliStore(),
        state = await assertReviewState(store, planFile),
        next: ReviewState = {
          ...state,
          status: ReviewStatus.active,
          decision: null,
          approvedAt: null,
          approvedMode: null
        }

      await store.save(next)
      printReviewState(next)
    }
  }
}
