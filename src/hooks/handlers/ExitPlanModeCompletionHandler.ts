import type { ReviewDecision } from "../../state/index.js"
import {
  ReviewDecisionSource,
  ReviewState,
  ReviewStatus
} from "../../state/index.js"
import { resolveApprovalMode } from "../ApprovalMode.js"
import type { HookContext } from "../HookContext.js"
import type { PostToolUseHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import { locateReview } from "../ReviewLookup.js"
import type { HandlerResult } from "./HandlerResult.js"

/** Helpers of the `ExitPlanMode` completion recorder. */
export namespace ExitPlanModeCompletionHandler {
  /**
   * Reports whether a recorded decision is the one that approved this
   * `ExitPlanMode`.
   *
   * Only a menu answer the permission hook actually spent qualifies. That hook
   * writes `consumedAt` as it answers the prompt, so a spent decision is the
   * one piece of evidence a `PostToolUse` has that this plugin — rather than
   * Claude Code's own dialog — approved the call. An unspent decision, however
   * fresh, proves nothing: the user may have answered the built-in dialog while
   * a menu answer sat unused, and closing the review on it would record a mode
   * nobody picked.
   *
   * @param decision The recorded decision, or `null`.
   * @returns `true` when the user's menu answer is what approved the call.
   */
  export function isApprovingDecision(decision: ReviewDecision): boolean {
    return (
      decision != null &&
      decision.source === ReviewDecisionSource.ask_user_question &&
      decision.consumedAt != null
    )
  }
}

/**
 * Closes the review once `ExitPlanMode` has run: the plan was approved, so the
 * gate must stop firing for it until the review is reactivated. The mode is
 * recorded alongside, which is what the final "approved" Doc comment quotes.
 *
 * The review is closed only when the permission hook spent the user's own menu
 * answer on this call — that hook is the only thing that can prove the mode
 * switch happened. A plan approved through Claude Code's built-in dialog leaves
 * no evidence a hook can read, so the status stays `active` and `approvedMode`
 * stays `null` rather than being filled in from whatever decision happened to
 * be on record — a `cli` decision, or an unspent menu answer, followed by the
 * native dialog would otherwise close the review claiming a mode nobody picked.
 * The round protocol tells the model to omit the mode when it is unknown.
 *
 * @param input The `PostToolUse` payload of the `ExitPlanMode` call.
 * @param context Store, config and clock.
 * @returns Nothing; this handler only records.
 */
export async function handleExitPlanModeCompletion(
  input: PostToolUseHookInput,
  context: HookContext
): HandlerResult {
  const review = await locateReview(input, context)
  if (review == null || review.state == null) {
    return HookOutput.none()
  }

  const { state } = review,
    now = context.now()

  if (
    state.status !== ReviewStatus.active ||
    !ExitPlanModeCompletionHandler.isApprovingDecision(state.decision)
  ) {
    context.log.debug(
      "Review %s was not approved through the menu; leaving it %s",
      review.planSlug,
      state.status
    )
    return HookOutput.none()
  }

  const mode = resolveApprovalMode({
    choice: state.decision.choice,
    approveAutoMode: context.config.approveAutoMode
  })

  if (mode == null) {
    return HookOutput.none()
  }

  const next: ReviewState = {
    ...state,
    status: ReviewStatus.approved,
    approvedAt: now.toISOString(),
    approvedMode: mode
  }

  await context.store.save(next)
  context.log.debug("Review %s approved in mode %s", review.planSlug, mode)
  return HookOutput.none()
}
