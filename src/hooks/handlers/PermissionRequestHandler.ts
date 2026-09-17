import { sha256OfFile } from "../../plan/index.js"
import type { ReviewDecision, ReviewState } from "../../state/index.js"
import { ReviewDecisionSource, ReviewStatus } from "../../state/index.js"
import { isNonEmptyString } from "../../utils/index.js"
import { resolveApprovalMode } from "../ApprovalMode.js"
import type { HookContext } from "../HookContext.js"
import type { PermissionRequestHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import { locateReview } from "../ReviewLookup.js"
import type { HandlerResult } from "./HandlerResult.js"

/** Constants and freshness rules of the plan-approval answer. */
export namespace PermissionRequestHandler {
  /**
   * How long a recorded menu answer may be used to skip the built-in approval
   * dialog. An approval is a statement about a moment — the user looked at a
   * revision of the Doc and said yes — so one left lying in the state file is
   * not evidence about a much later `ExitPlanMode`, and the built-in dialog
   * takes over instead.
   */
  export const MaxDecisionAgeMs = 1_800_000

  /**
   * Reports whether a recorded decision may still answer a permission prompt
   * in place of the user: it must not have been spent on an earlier prompt, it
   * must not be dated in the future, and it must be younger than
   * {@link MaxDecisionAgeMs}.
   *
   * A timestamp ahead of the clock is refused rather than treated as very
   * fresh. The window exists to make an approval expire, and a decision written
   * with a future `at` — a hand-edited state file, a machine whose clock moved
   * backwards — would otherwise stay usable for as long as it is ahead, which
   * is the one thing the window is there to prevent.
   *
   * @param decision The recorded decision, or `null`.
   * @param now Current time, from the injected clock.
   * @returns `true` when the decision is unconsumed, not future-dated and fresh.
   */
  export function isDecisionUsable(
    decision: ReviewDecision,
    now: Date
  ): boolean {
    if (decision == null || decision.consumedAt != null) {
      return false
    }
    const recordedAtMs = Date.parse(decision.at),
      ageMs = now.getTime() - recordedAtMs
    return (
      Number.isFinite(recordedAtMs) && ageMs >= 0 && ageMs < MaxDecisionAgeMs
    )
  }
}

/**
 * Answers the plan-approval prompt in place of the built-in dialog.
 *
 * The prompt is only answered when the review is active, the Doc holds exactly
 * the plan text being approved, and the recorded decision was given for that
 * same text — by the user, on the menu, recently, and not already spent: the
 * allow carries the `setMode` update the built-in "Yes, auto-accept edits" /
 * "Yes, manually approve edits" rows would have applied. A decision recorded
 * through the CLI is never answered here, because only an `AskUserQuestion`
 * answer proves the user, rather than the model, chose it.
 *
 * Anything else is left alone, so the built-in dialog remains the fallback.
 *
 * The decision is marked `consumedAt` **before** the allow is returned, and
 * deliberately so: if the write fails, the whole handler throws and the hook
 * prints nothing, which leaves the built-in dialog in place. Moving the write
 * after the allow would invert that — a failed write would leave an unspent
 * approval behind that the next `ExitPlanMode` could use a second time.
 *
 * @param input The `PermissionRequest` payload of the `ExitPlanMode` prompt.
 * @param context Store, config, clock and locator.
 * @returns An allow carrying the mode switch, or nothing.
 */
export async function handlePermissionRequest(
  input: PermissionRequestHookInput,
  context: HookContext
): HandlerResult {
  const review = await locateReview(input, context)
  if (review == null || review.state == null) {
    return HookOutput.none()
  }

  const { state } = review
  if (state.status !== ReviewStatus.active) {
    return HookOutput.none()
  }

  const planSha256 = await sha256OfFile(review.planFile),
    { decision, lastSync } = state,
    now = context.now()

  if (
    !isNonEmptyString(planSha256) ||
    decision == null ||
    decision.source !== ReviewDecisionSource.ask_user_question ||
    !PermissionRequestHandler.isDecisionUsable(decision, now) ||
    decision.planSha256 !== planSha256 ||
    lastSync == null ||
    lastSync.planSha256 !== planSha256
  ) {
    return HookOutput.none()
  }

  const mode = resolveApprovalMode({
    choice: decision.choice,
    approveAutoMode: context.config.approveAutoMode,
    permissionSuggestions: input.permission_suggestions
  })

  if (mode == null) {
    return HookOutput.none()
  }

  const next: ReviewState = {
    ...state,
    decision: { ...decision, consumedAt: now.toISOString() }
  }
  await context.store.save(next)

  context.log.debug("Approving ExitPlanMode with mode %s", mode)
  return HookOutput.permissionRequestAllow([HookOutput.newSetModeUpdate(mode)])
}
