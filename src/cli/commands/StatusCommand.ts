import type { CommandModule, Options } from "yargs"

import { renderSafeDocumentUrl } from "../../google/index.js"
import { PlanFileLocator } from "../../plan/index.js"
import type { ReviewState } from "../../state/index.js"
import { ReviewStateText } from "../../state/index.js"
import { CliSubcommand, isNonEmptyString } from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import { createCliStore } from "../CliState.js"
import {
  assertReviewState,
  printJson,
  printLine,
  printReviewState,
  readOptionalPlanFile
} from "../commandSupport.js"

/** Arguments of the `status` command. */
export interface StatusCommandArguments extends CliState.Arguments {
  /** Plan markdown file to report on; every active review when absent. */
  plan?: string

  /** Print the raw state document instead of the readable report. */
  json?: boolean
}

/** One labelled line of the readable status report. */
export interface StatusRow {
  /** Field name shown on the left. */
  label: string

  /** Field value shown on the right. */
  value: string
}

/** Constants and renderers of the `status` command. */
export namespace StatusCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Report one review, or every active review when --plan is omitted"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: {
      type: "string",
      describe:
        "Plan markdown file to report on; omit to list every active review"
    },
    json: {
      type: "boolean",
      default: false,
      describe: "Print the raw review state as JSON"
    }
  }

  /** Value shown for a field the review has not filled in yet. */
  export const NotSetValue = "—"

  /** Separator between a row's label and its value. */
  export const RowSeparator = ": "

  /** Report printed when no review is active. */
  export const NoActiveReviewsMessage = "No active reviews."

  /** Separator between two reviews in the readable list. */
  export const ReviewSeparator = "\n"

  /**
   * Renders the Doc link of a review.
   *
   * The link is rebuilt from the recorded file id rather than printed as
   * stored: this report is read by a person and, when the model runs `status`,
   * lands in its context too, so it must never carry an address — or a payload
   * hung off one — that reached the state file from a tool response.
   *
   * @param state The review to render the link of.
   * @returns The canonical Doc URL, or the not-set value when no Doc is registered.
   */
  export function renderDocUrl(state: ReviewState): string {
    const { doc } = state
    return doc == null ? NotSetValue : renderSafeDocumentUrl(doc.id)
  }

  /** Longest value one row of the readable report prints. */
  export const MaxValueLength = 1_024

  /**
   * Renders a value that may be absent.
   *
   * Everything printed here reaches a terminal, and — when the model runs
   * `status` — its context: a Drive path, a Shared Drive name and a Doc title
   * all arrive from outside the plugin. The value therefore goes through the
   * sanitiser on the way out as well as on the way in, so a state file written
   * by an older version, or edited by hand, cannot put an escape sequence on
   * the reader's screen.
   *
   * @param value Candidate value.
   * @returns The sanitised value, or {@link StatusCommand.NotSetValue}.
   */
  export function renderValue(value: string): string {
    const sanitized = ReviewStateText.sanitizeText(value, MaxValueLength)
    return isNonEmptyString(sanitized) ? sanitized : NotSetValue
  }

  /**
   * Renders labelled rows with their labels padded to one width.
   *
   * @param rows Rows to render, in presentation order.
   * @returns The rendered block, without a trailing newline.
   */
  export function renderRows(rows: StatusRow[]): string {
    const width = rows.reduce(
      (widest, row) => Math.max(widest, row.label.length),
      0
    )
    return rows
      .map(row => `${row.label.padEnd(width)}${RowSeparator}${row.value}`)
      .join("\n")
  }

  /**
   * Renders the full report of one review.
   *
   * @param state The review to report on.
   * @returns The readable report.
   */
  export function renderReview(state: ReviewState): string {
    const { lastSync, decision, target } = state,
      rows: StatusRow[] = [
        { label: "Plan", value: state.planFile },
        { label: "Status", value: state.status },
        {
          label: "Target",
          value: `${target.kind} ${renderValue(target.path)}`
        },
        { label: "Drive", value: renderValue(target.driveName) },
        {
          label: "Doc title",
          value: renderValue(state.doc == null ? null : state.doc.title)
        },
        { label: "Doc", value: renderDocUrl(state) },
        { label: "Revision", value: String(state.revision) },
        {
          label: "Last sync",
          value:
            lastSync == null
              ? NotSetValue
              : `revision ${lastSync.revision} at ${lastSync.at}`
        },
        {
          label: "Decision",
          value:
            decision == null
              ? NotSetValue
              : `${decision.choice} at ${decision.at}`
        },
        { label: "Log thread", value: renderValue(state.logCommentId) },
        { label: "Sync mode", value: state.syncMode }
      ]

    return renderRows(rows)
  }

  /**
   * Renders one line per active review.
   *
   * @param states The active reviews.
   * @returns The readable list, or the "nothing active" message.
   */
  export function renderActiveList(states: ReviewState[]): string {
    if (states.length === 0) {
      return NoActiveReviewsMessage
    }

    const rows: StatusRow[] = states.map(state => ({
      label: PlanFileLocator.planSlug(state.planFile),
      value: `revision ${state.revision}  ${renderDocUrl(state)}`
    }))

    return renderRows(rows)
  }
}

/**
 * Builds the `status` command: the plugin's only read-only command, and the
 * first thing to run when a review behaves unexpectedly.
 *
 * @returns The yargs command module.
 */
export function createStatusCommand(): CommandModule<
  CliState.Arguments,
  StatusCommandArguments
> {
  return {
    command: CliSubcommand.status,
    describe: StatusCommand.Description,
    builder: StatusCommand.OptionDefinitions,
    handler: async argv => {
      const { plan, json = false } = argv,
        planFile = readOptionalPlanFile(plan),
        store = await createCliStore()

      if (!isNonEmptyString(planFile)) {
        const states = await store.listActive()
        if (json) {
          printJson(states)
          return
        }
        printLine(StatusCommand.renderActiveList(states))
        return
      }

      const state = await assertReviewState(store, planFile)
      if (json) {
        printReviewState(state)
        return
      }
      printLine(StatusCommand.renderReview(state))
    }
  }
}
