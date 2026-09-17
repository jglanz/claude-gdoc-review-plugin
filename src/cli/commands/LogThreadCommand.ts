import Assert from "node:assert"

import type { CommandModule, Options } from "yargs"

import type { ReviewState } from "../../state/index.js"
import { ReviewStateText } from "../../state/index.js"
import { CliSubcommand } from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import { createCliStore } from "../CliState.js"
import {
  assertReviewState,
  PlanOptionDefinition,
  printReviewState,
  resolvePlanFile
} from "../commandSupport.js"

/** Arguments of the `log-thread` command. */
export interface LogThreadCommandArguments extends CliState.Arguments {
  /** Plan markdown file the review is keyed by. */
  plan: string

  /** Doc comment id of the revision-log thread. */
  "comment-id": string
}

/** Constants of the `log-thread` command. */
export namespace LogThreadCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Record the Doc comment id of the revision-log thread"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: PlanOptionDefinition,
    "comment-id": {
      type: "string",
      demandOption: true,
      describe: "Comment id of the revision-log thread"
    }
  }

  /**
   * States that `--comment-id` is not a Google Docs comment id.
   *
   * The value becomes part of the review state and is printed back by `status`,
   * so it is held to the shape a comment id has rather than stored as typed.
   *
   * @param commentId The value as the caller typed it.
   * @returns The assertion message.
   */
  export function newInvalidCommentIdMessage(commentId: string): string {
    return `--comment-id is not a Google Docs comment id: ${commentId}`
  }
}

/**
 * Builds the `log-thread` command.
 *
 * The revision-log thread is where every round posts its "Rev N synced" entry,
 * so its comment id is part of the review state. The PostToolUse comment
 * recorder captures it automatically when the skill creates the thread; this
 * command is the explicit path for a thread that already existed.
 *
 * @returns The yargs command module.
 */
export function createLogThreadCommand(): CommandModule<
  CliState.Arguments,
  LogThreadCommandArguments
> {
  return {
    command: CliSubcommand["log-thread"],
    describe: LogThreadCommand.Description,
    builder: LogThreadCommand.OptionDefinitions,
    handler: async argv => {
      const planFile = resolvePlanFile(argv.plan),
        { "comment-id": commentId } = argv

      Assert.ok(
        ReviewStateText.isCommentId(commentId),
        LogThreadCommand.newInvalidCommentIdMessage(commentId)
      )

      const store = await createCliStore(),
        state = await assertReviewState(store, planFile),
        next: ReviewState = { ...state, logCommentId: commentId }

      await store.save(next)
      printReviewState(next)
    }
  }
}
