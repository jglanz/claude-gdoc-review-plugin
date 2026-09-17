import { renderSafeDocumentUrl } from "../../google/index.js"
import { ReviewState, ReviewStatus } from "../../state/index.js"
import type { HookContext } from "../HookContext.js"
import type { SessionStartHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import { locateReview } from "../ReviewLookup.js"
import type { HandlerResult } from "./HandlerResult.js"

/** Constants and message builders of the session-start reminder. */
export namespace SessionStartHandler {
  /** Instruction repeated on every resumed or compacted session. */
  export const ProtocolReminder =
    "Follow the gdoc-review round before ExitPlanMode — sync the plan into the Doc, answer the reviewer comments, then present the review menu. The hooks enforce it."

  /**
   * Builds the context a resumed session is reminded with.
   *
   * The Doc link is rebuilt from the recorded file id, so a link put into the
   * state file by a tool response cannot become an arbitrary address — or an
   * arbitrary instruction hung off a URL tail — in the resumed session's
   * context.
   *
   * @param state The active review.
   * @param planFile Absolute path of the plan markdown file.
   * @returns The reminder text.
   */
  export function newReminder(state: ReviewState, planFile: string): string {
    return [
      `A Google Doc plan review is active: ${renderSafeDocumentUrl(state.doc.id)}`,
      `Plan file: ${planFile}`,
      ProtocolReminder
    ].join("\n")
  }
}

/**
 * Reminds a resumed or compacted session that its plan is under review, since
 * the protocol the gate enforces may have been compacted out of the context.
 *
 * @param input The `SessionStart` payload.
 * @param context Store and locator.
 * @returns Session context naming the Doc and the protocol, or nothing.
 */
export async function handleSessionStart(
  input: SessionStartHookInput,
  context: HookContext
): HandlerResult {
  const review = await locateReview(input, context)
  if (review == null || review.state == null) {
    return HookOutput.none()
  }

  const { state } = review
  if (state.status !== ReviewStatus.active || state.doc == null) {
    return HookOutput.none()
  }

  return HookOutput.sessionStartContext(
    SessionStartHandler.newReminder(state, review.planFile)
  )
}
