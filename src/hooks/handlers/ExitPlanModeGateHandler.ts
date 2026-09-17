import { match } from "ts-pattern"

import { isDocumentId, renderSafeDocumentUrl } from "../../google/index.js"
import { Logger } from "../../logging/index.js"
import { sha256OfFile } from "../../plan/index.js"
import { RoundProtocolRenderer } from "../../round/index.js"
import {
  ReviewDecisionChoice,
  ReviewState,
  ReviewStatus
} from "../../state/index.js"
import type { HookContext } from "../HookContext.js"
import type { PreToolUseHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import { locateReview } from "../ReviewLookup.js"
import type { HandlerResult } from "./HandlerResult.js"
import { PermissionRequestHandler } from "./PermissionRequestHandler.js"

/** Helpers of the `ExitPlanMode` gate. */
export namespace ExitPlanModeGateHandler {
  /**
   * Numbers the revision the demanded round will produce.
   *
   * @param state The review the gate is blocking on.
   * @returns The revision after the last recorded one.
   */
  export function nextRevisionOf(state: ReviewState): number {
    return state.revision + 1
  }

  /**
   * Lead-in of the deny the gate answers with when it cannot render its own
   * protocol. The text is fixed: whatever failed is diagnostic detail the log
   * carries, and putting an exception's message in a deny reason would let a
   * broken install dictate what the model reads.
   */
  export const FailureReason =
    "The gdoc-review plan gate could not build the review round for this plan, so the plan cannot be approved. This is a plugin installation or state failure — the protocol template, the review state or the plugin configuration could not be read."

  /**
   * States where the operator can read what actually failed.
   *
   * @param logFile Absolute path of the plugin's diagnostic log.
   * @returns The deny reason a failing gate answers with.
   */
  export function newFailureReason(logFile: string): string {
    return [
      FailureReason,
      `Tell the user to check ${logFile}, and do not call ExitPlanMode again until they say the install is fixed.`
    ].join("\n\n")
  }

  /** Revision a plan with no review would produce if one were set up for it. */
  export const FirstRevision = 1

  /**
   * Reports a plan that has no review while others are active.
   *
   * @param planFile Plan the session is presenting.
   * @param activeCount How many reviews are active in the same state directory.
   * @returns The warning written to the log.
   */
  export function newForeignPlanMessage(
    planFile: string,
    activeCount: number
  ): string {
    return `${planFile} has no review, but ${activeCount} review(s) in this state directory are active; denying rather than approving it silently`
  }

  /**
   * Resolves the diagnostic log file of the state directory a context writes.
   *
   * @param context The hook context whose store names the state directory.
   * @returns Absolute path of `log.jsonl`.
   */
  export function logFileOf(context: HookContext): string {
    return Logger.newLogFile(context.store.config.stateDirectory)
  }
}

function createRenderInput(
  state: ReviewState,
  planFile: string,
  context: HookContext
): RoundProtocolRenderer.Input {
  const { doc, syncMode } = state
  return {
    docUrl: doc == null ? null : renderSafeDocumentUrl(doc.id),
    docId: doc != null && isDocumentId(doc.id) ? doc.id : null,
    nextRevision: ExitPlanModeGateHandler.nextRevisionOf(state),
    planFile,
    syncMode,
    replyPrefix: context.config.replyPrefix,
    approveAutoMode: context.config.approveAutoMode
  }
}

/**
 * Answers a plan that has no review of its own while the state directory holds
 * reviews that are still open.
 *
 * Staying silent here is the one case where "no review" is not the same as
 * "this plugin has nothing to say": the user set up a review for some plan, and
 * the plan now being presented is a different one. That is either the wrong
 * plan or a review the session lost track of, and both are things the user has
 * to see rather than an approval that quietly goes through.
 */
async function denyForeignPlan(
  planFile: string,
  context: HookContext
): HandlerResult {
  const active = await context.store.listActive()
  if (active.length === 0) {
    return HookOutput.none()
  }

  context.log.warn(
    "%s",
    ExitPlanModeGateHandler.newForeignPlanMessage(planFile, active.length)
  )
  return HookOutput.preToolUseDeny(
    context.renderer.renderForeignPlan(
      {
        docUrl: null,
        docId: null,
        nextRevision: ExitPlanModeGateHandler.FirstRevision,
        planFile,
        replyPrefix: context.config.replyPrefix
      },
      active.map(state => state.planFile)
    )
  )
}

async function runExitPlanModeGate(
  input: PreToolUseHookInput,
  context: HookContext
): HandlerResult {
  const review = await locateReview(input, context)
  if (review == null) {
    return HookOutput.none()
  }
  if (review.state == null) {
    return await denyForeignPlan(review.planFile, context)
  }

  const { state, planFile } = review,
    renderInput = createRenderInput(state, planFile, context),
    { renderer } = context

  if (state.status !== ReviewStatus.active) {
    return match(state.status)
      .with(ReviewStatus.setup, () =>
        HookOutput.preToolUseDeny(renderer.renderSetupIncomplete(renderInput))
      )
      .otherwise(() => {
        context.log.debug(
          "Review %s is %s, gate stays silent",
          review.planSlug,
          state.status
        )
        return HookOutput.none()
      })
  }

  if (state.doc == null) {
    return HookOutput.preToolUseDeny(
      renderer.renderSetupIncomplete(renderInput)
    )
  }

  const planSha256 = await sha256OfFile(planFile),
    { lastSync, decision } = state

  if (lastSync == null || lastSync.planSha256 !== planSha256) {
    return HookOutput.preToolUseDeny(renderer.renderRound(renderInput))
  }

  if (
    decision == null ||
    decision.planSha256 !== planSha256 ||
    !PermissionRequestHandler.isDecisionUsable(decision, context.now())
  ) {
    return HookOutput.preToolUseDeny(
      renderer.renderPresentMenu({
        ...renderInput,
        menuRevision: state.revision
      })
    )
  }

  return match(decision.choice)
    .with(ReviewDecisionChoice.check_doc, () =>
      HookOutput.preToolUseDeny(renderer.renderRecheckDoc(renderInput))
    )
    .with(ReviewDecisionChoice.other, () =>
      HookOutput.preToolUseDeny(
        renderer.renderFollowUserInstruction({
          ...renderInput,
          userInstruction: decision.text
        })
      )
    )
    .with(
      ReviewDecisionChoice.approve_auto,
      ReviewDecisionChoice.approve_manual,
      () => HookOutput.none()
    )
    .exhaustive()
}

/**
 * The `ExitPlanMode` gate: the only place plan/Doc consistency is decided.
 *
 * A plan with no review at all, and one whose review the user closed
 * (`cancelled`) or whose approval already went through (`approved`), is left to
 * the engine's built-in approval dialog. An active review is denied — with the
 * rendered round protocol, or the short reason matching the recorded menu
 * choice — until the plan is synced and an unspent, fresh approval is on record
 * for exactly this plan text, at which point the hook stays silent and the
 * permission flow takes over. A consumed or stale decision counts as no
 * decision at all, so the menu is presented again.
 *
 * A review still in `setup` is denied with the remaining setup steps. That is
 * the state a `/gdoc-review` interrupted before `register` leaves behind: the
 * user asked for the plan to be reviewed in a Doc, and there is no Doc yet, so
 * approving the plan now would quietly skip the review rather than fall back
 * to it.
 *
 * The gate fails **closed**. Every other handler only records, so the
 * dispatcher's guard answering a thrown handler with "print nothing" is right
 * for them; for this one "print nothing" would let a broken install wave the
 * plan through unreviewed. A missing protocol template, an unknown placeholder,
 * an unsafe review key or an unreadable state file is therefore answered with a
 * deny naming the failure class and the log file, and the exception itself goes
 * only to the log.
 *
 * @param input The `PreToolUse` payload of the `ExitPlanMode` call.
 * @param context Store, locator, renderer and clock.
 * @returns A deny carrying what the model must do, or nothing.
 */
export async function handleExitPlanModeGate(
  input: PreToolUseHookInput,
  context: HookContext
): HandlerResult {
  try {
    return await runExitPlanModeGate(input, context)
  } catch (cause) {
    const logFile = ExitPlanModeGateHandler.logFileOf(context)
    context.log.error(
      "ExitPlanMode gate failed, denying: %s",
      cause instanceof Error ? cause.message : String(cause)
    )
    return HookOutput.preToolUseDeny(
      ExitPlanModeGateHandler.newFailureReason(logFile)
    )
  }
}
