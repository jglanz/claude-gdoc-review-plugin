import Assert from "node:assert"

import type { CommandModule, Options } from "yargs"

import { sha256OfFile } from "../../plan/index.js"
import type { ReviewState } from "../../state/index.js"
import { GatedCliSubcommand, isNonEmptyString } from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import { createCliStore } from "../CliState.js"
import {
  assertReviewState,
  PlanOptionDefinition,
  printReviewState,
  resolvePlanFile
} from "../commandSupport.js"

/** Arguments of the `synced` command. */
export interface SyncedCommandArguments extends CliState.Arguments {
  /** Plan markdown file the review is keyed by. */
  plan: string
}

/** Constants and message builders of the `synced` command. */
export namespace SyncedCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Record that the Doc now holds the current plan text (bumps the revision)"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: PlanOptionDefinition
  }

  /**
   * States that the plan file has no text to record a sync for.
   *
   * @param planFile Absolute path of the plan markdown file.
   * @returns The assertion message.
   */
  export function newMissingPlanTextMessage(planFile: string): string {
    return `No plan text at ${planFile} to record a sync for`
  }
}

/**
 * Builds the `synced` command: the fallback for the `update_drive_file`
 * PostToolUse recorder.
 *
 * It records the digest of the plan text as of now against the next revision,
 * which is precisely what the `ExitPlanMode` gate compares the plan against —
 * so running it while the Doc does NOT hold that text defeats the gate. It
 * exists for the case where the sync succeeded but the hook did not observe it.
 * For that reason it is never auto-allowed through Bash
 * ({@link GatedCliSubcommand}): running it always asks the user first.
 *
 * @returns The yargs command module.
 */
export function createSyncedCommand(): CommandModule<
  CliState.Arguments,
  SyncedCommandArguments
> {
  return {
    command: GatedCliSubcommand.synced,
    describe: SyncedCommand.Description,
    builder: SyncedCommand.OptionDefinitions,
    handler: async argv => {
      const planFile = resolvePlanFile(argv.plan),
        store = await createCliStore(),
        state = await assertReviewState(store, planFile),
        planSha256 = await sha256OfFile(planFile)

      Assert.ok(
        isNonEmptyString(planSha256),
        SyncedCommand.newMissingPlanTextMessage(planFile)
      )

      const revision = state.revision + 1,
        next: ReviewState = {
          ...state,
          revision,
          lastSync: {
            at: new Date().toISOString(),
            planSha256,
            revision
          }
        }

      await store.save(next)
      printReviewState(next)
    }
  }
}
