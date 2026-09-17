import Assert from "node:assert"

import { match } from "ts-pattern"
import type { CommandModule, Options } from "yargs"

import { sha256OfFile } from "../../plan/index.js"
import { ReviewMenuLabel } from "../../round/index.js"
import type { ReviewState } from "../../state/index.js"
import {
  ReviewDecisionChoice,
  ReviewDecisionSource
} from "../../state/index.js"
import { GatedCliSubcommand, isNonEmptyString } from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import { createCliStore } from "../CliState.js"
import {
  assertReviewState,
  PlanOptionDefinition,
  printReviewState,
  resolvePlanFile
} from "../commandSupport.js"

/** Arguments of the `decision` command. */
export interface DecisionCommandArguments extends CliState.Arguments {
  /** Plan markdown file the review is keyed by. */
  plan: string

  /** The menu answer being recorded. */
  choice: ReviewDecisionChoice

  /** The user's own words, for a free-text answer. */
  text?: string
}

/** Constants and helpers of the `decision` command. */
export namespace DecisionCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Record the approval-menu answer for the current plan text"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: PlanOptionDefinition,
    choice: {
      type: "string",
      demandOption: true,
      choices: Object.values(ReviewDecisionChoice),
      describe: "The menu answer to record"
    },
    text: {
      type: "string",
      describe:
        "The user's own words; recorded as the decision text for --choice other"
    }
  }

  /**
   * States that the plan file has no text to pin the decision to.
   *
   * @param planFile Absolute path of the plan markdown file.
   * @returns The assertion message.
   */
  export function newMissingPlanTextMessage(planFile: string): string {
    return `No plan text at ${planFile} to pin the decision to`
  }

  /**
   * Renders the menu label a choice corresponds to, so a decision recorded
   * through the CLI carries the same shape the `AskUserQuestion` hook records.
   *
   * @param choice The recorded choice.
   * @param text The user's own words, used as the label of a free-text answer.
   * @returns The label stored with the decision.
   */
  export function labelFor(choice: ReviewDecisionChoice, text: string): string {
    return match(choice)
      .with(
        ReviewDecisionChoice.approve_auto,
        () => `${ReviewMenuLabel.approveAuto}`
      )
      .with(
        ReviewDecisionChoice.approve_manual,
        () => `${ReviewMenuLabel.approveManual}`
      )
      .with(ReviewDecisionChoice.check_doc, () => `${ReviewMenuLabel.checkDoc}`)
      .with(ReviewDecisionChoice.other, () =>
        isNonEmptyString(text) ? text : `${ReviewMenuLabel.somethingElse}`
      )
      .exhaustive()
  }
}

/**
 * Builds the `decision` command: the fallback for the approval menu when the
 * `AskUserQuestion` PostToolUse hook did not capture the answer.
 *
 * The decision is pinned to the digest of the plan text it was given for —
 * exactly as the hook pins it — so editing the plan afterwards invalidates the
 * approval and the gate demands a fresh round.
 *
 * It is recorded with `source: cli`, which the `PermissionRequest` hook never
 * auto-approves: an approve choice recorded here opens the gate, and Claude
 * Code's own approval dialog then asks the user, because nothing proves the
 * user — rather than the model — wrote it. The command is also never
 * auto-allowed through Bash ({@link GatedCliSubcommand}).
 *
 * @returns The yargs command module.
 */
export function createDecisionCommand(): CommandModule<
  CliState.Arguments,
  DecisionCommandArguments
> {
  return {
    command: GatedCliSubcommand.decision,
    describe: DecisionCommand.Description,
    builder: DecisionCommand.OptionDefinitions,
    handler: async argv => {
      const planFile = resolvePlanFile(argv.plan),
        { choice, text = null } = argv,
        store = await createCliStore(),
        state = await assertReviewState(store, planFile),
        planSha256 = await sha256OfFile(planFile)

      Assert.ok(
        isNonEmptyString(planSha256),
        DecisionCommand.newMissingPlanTextMessage(planFile)
      )

      const next: ReviewState = {
        ...state,
        decision: {
          choice,
          label: DecisionCommand.labelFor(choice, text),
          text: choice === ReviewDecisionChoice.other ? text : null,
          planSha256,
          at: new Date().toISOString(),
          source: ReviewDecisionSource.cli,
          toolUseId: null,
          consumedAt: null
        }
      }

      await store.save(next)
      printReviewState(next)
    }
  }
}
