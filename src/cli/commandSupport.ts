import Assert from "node:assert"
import path from "node:path"

import type { Options } from "yargs"

import { writeStdout } from "../logging/index.js"
import { PlanFileLocator } from "../plan/index.js"
import type { ReviewState, ReviewStateStore } from "../state/index.js"
import { ReviewStateCodec } from "../state/index.js"
import { isNonEmptyString, isString } from "../utils/index.js"

/** Constants and message builders shared by every command. */
export namespace CommandSupport {
  /** Line terminator every printed line ends with. */
  export const LineSeparator = "\n"

  /** Indentation of the JSON a command prints. */
  export const JsonIndent = 2

  /** Message of the assertion guarding a missing or empty `--plan` value. */
  export const MissingPlanFileMessage =
    "--plan requires the path of the plan markdown file"

  /**
   * Message of the assertion guarding a repeated `--plan`.
   *
   * yargs collects a repeated option into an array, while the PreToolUse Bash
   * gate reads the first occurrence and compares that one against the plan the
   * session is presenting. A command that acted on any other occurrence would
   * therefore act on a plan the gate never checked, so a repetition is refused
   * outright rather than resolved in either direction.
   */
  export const RepeatedPlanFileMessage =
    "--plan was given more than once; pass it exactly once"

  /**
   * States that no review exists for a plan file.
   *
   * @param planFile Absolute path of the plan markdown file.
   * @returns The assertion message.
   */
  export function newMissingReviewMessage(planFile: string): string {
    return `No review state for ${planFile} — run the init command first`
  }
}

/**
 * The `--plan` option every review command requires. Shared so the spelling,
 * the description and the "required" flag exist in exactly one place.
 */
export const PlanOptionDefinition: Options = {
  type: "string",
  demandOption: true,
  describe: "Path of the plan markdown file under review"
}

/**
 * Validates a `--plan` value and makes it absolute, because the review key and
 * every recorded path must not depend on the working directory a hook happens
 * to run in.
 *
 * @param planFile Plan file as the caller typed it.
 * @returns The absolute plan file path.
 */
export function resolvePlanFile(planFile: string): string {
  Assert.ok(
    planFile == null || isString(planFile),
    CommandSupport.RepeatedPlanFileMessage
  )
  Assert.ok(isNonEmptyString(planFile), CommandSupport.MissingPlanFileMessage)
  return path.resolve(planFile)
}

/**
 * Reads a `--plan` value that the command treats as optional.
 *
 * A repeated flag is refused here too: "absent" and "given twice" are different
 * things, and taking the second for the first would quietly turn a command
 * about one plan into a command about every review.
 *
 * @param planFile Plan file as the caller typed it, or nothing.
 * @returns The absolute plan file path, or `null` when the flag was absent.
 */
export function readOptionalPlanFile(planFile: string): string {
  Assert.ok(
    planFile == null || isString(planFile),
    CommandSupport.RepeatedPlanFileMessage
  )
  return isNonEmptyString(planFile) ? resolvePlanFile(planFile) : null
}

/**
 * Writes one line of protocol output to stdout.
 *
 * @param text Line to write, without its terminator.
 */
export function printLine(text: string): void {
  writeStdout(`${text}${CommandSupport.LineSeparator}`)
}

/**
 * Prints a value as pretty JSON.
 *
 * @param value Anything JSON-serializable.
 */
export function printJson(value: unknown): void {
  printLine(JSON.stringify(value, null, CommandSupport.JsonIndent))
}

/**
 * Prints a review state through its codec, so what a command prints is exactly
 * what is on disk — an invalid state fails here instead of being reported as
 * success.
 *
 * @param state The state to print.
 */
export function printReviewState(state: ReviewState): void {
  printLine(ReviewStateCodec.serialize(state))
}

/**
 * Loads the review of a plan file, failing when there is none.
 *
 * @param store Store to read.
 * @param planFile Absolute path of the plan markdown file.
 * @returns The validated review state.
 */
export async function assertReviewState(
  store: ReviewStateStore,
  planFile: string
): Promise<ReviewState> {
  const state = await store.load(PlanFileLocator.planSlug(planFile))
  Assert.ok(state != null, CommandSupport.newMissingReviewMessage(planFile))
  return state
}
