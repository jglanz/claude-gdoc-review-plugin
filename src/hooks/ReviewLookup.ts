import path from "node:path"

import { NestedError } from "../errors/index.js"
import { PlanFileLocator } from "../plan/index.js"
import { ReviewState } from "../state/index.js"
import { isNonEmptyString } from "../utils/index.js"
import type { HookContext } from "./HookContext.js"
import type { HookInput } from "./HookInput.js"

/** The review a hook payload is about, resolved from the session's plan file. */
export interface ReviewLookup {
  /** Absolute path of the plan markdown file the session is presenting. */
  planFile: string

  /** Review key derived from the plan file. */
  planSlug: string

  /** Persisted review, or `null` when the plan has none. */
  state: ReviewState
}

/** Constants and message builders of the review lookup. */
export namespace ReviewLookup {
  /**
   * Reports a review document whose own `planFile` is not the located one.
   *
   * @param planSlug Review key the plan file resolves to.
   * @param recordedPlanFile Plan file the document names.
   * @param locatedPlanFile Plan file the session is presenting.
   * @returns The message of the error the lookup fails with.
   */
  export function newForeignReviewMessage(
    planSlug: string,
    recordedPlanFile: string,
    locatedPlanFile: string
  ): string {
    return `Review ${planSlug} names plan file ${recordedPlanFile}, not ${locatedPlanFile}`
  }
}

function isSamePlanFile(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right)
}

/**
 * Finds the review a hook payload is about: the plan file comes from the
 * session transcript (or the sessions map), the review from the state
 * directory.
 *
 * A loaded review whose own `planFile` is not the located one **fails the
 * lookup**: the review key is derived from the plan path, so a document naming
 * a different plan is a key collision or a hand-edited state file, and acting
 * on it would apply one plan's approval to another plan's text. Throwing is
 * what makes the two callers differ where they must — the `ExitPlanMode` gate
 * catches it and denies, every recorder runs inside the dispatcher's guard and
 * simply records nothing.
 *
 * @param input The hook payload naming the session and its transcript.
 * @param context Store and locator the lookup runs against.
 * @returns The lookup, or `null` when no plan file could be located at all.
 */
export async function locateReview(
  input: HookInput,
  context: HookContext
): Promise<ReviewLookup> {
  const { transcript_path: transcriptPath, session_id: sessionId } = input,
    planFile = await context.locator.locate({
      explicitPlanFile: null,
      transcriptPath,
      sessionId
    })

  if (!isNonEmptyString(planFile)) {
    context.log.debug("No plan file for session %s", sessionId)
    return null
  }

  const planSlug = PlanFileLocator.planSlug(planFile),
    state = await context.store.load(planSlug)

  if (state != null && !isSamePlanFile(state.planFile, planFile)) {
    throw new NestedError(
      ReviewLookup.newForeignReviewMessage(planSlug, state.planFile, planFile),
      { context: { planSlug, recordedPlanFile: state.planFile, planFile } }
    )
  }

  return { planFile, planSlug, state }
}
