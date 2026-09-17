import { match } from "ts-pattern"

import { GDocReview } from "../../Constants.js"
import {
  DocumentCommentAction,
  parseCreatedComment
} from "../../google/index.js"
import {
  CommentAction,
  ReviewState,
  ReviewStateText
} from "../../state/index.js"
import { isString } from "../../utils/index.js"
import type { HookContext } from "../HookContext.js"
import type { PostToolUseHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import type { ReviewLookup } from "../ReviewLookup.js"
import { locateReview } from "../ReviewLookup.js"
import { readToolResponseText } from "../ToolResponseText.js"
import type { HandlerResult } from "./HandlerResult.js"

/** Constants and message builders of the comment recorder. */
export namespace CommentRecorderHandler {
  /**
   * Reports a comment id the review will not record.
   *
   * The id becomes a key in the persisted `comments` map and, for the revision
   * log, a value the `status` report prints, so it is held to the shape a
   * Google Docs comment id actually has rather than stored as whatever the
   * response or the model's arguments carried.
   *
   * @param commentId The value as it arrived.
   * @returns The message written to the log.
   */
  export function newInvalidCommentIdMessage(commentId: unknown): string {
    return `Not a Google Docs comment id, so nothing was recorded for it: ${String(commentId)}`
  }
}

async function recordCreatedComment(
  input: PostToolUseHookInput,
  context: HookContext,
  review: ReviewLookup,
  responseText: string
): HandlerResult {
  const created = parseCreatedComment(responseText),
    { comment_content: commentContent } = input.tool_input,
    marker = GDocReview.newRevisionLogMarker(context.config.replyPrefix)

  if (
    created == null ||
    !isString(commentContent) ||
    !commentContent.trim().startsWith(marker)
  ) {
    return HookOutput.none()
  }

  const { commentId } = created
  if (!ReviewStateText.isCommentId(commentId)) {
    context.log.warn(
      "%s",
      CommentRecorderHandler.newInvalidCommentIdMessage(commentId)
    )
    return HookOutput.none()
  }

  const next: ReviewState = { ...review.state, logCommentId: commentId }
  await context.store.save(next)
  context.log.debug("Recorded revision-log comment %s", commentId)
  return HookOutput.none()
}

async function recordCommentAction(
  input: PostToolUseHookInput,
  context: HookContext,
  review: ReviewLookup,
  lastAction: CommentAction
): HandlerResult {
  const { comment_id: commentId } = input.tool_input
  if (!ReviewStateText.isCommentId(commentId)) {
    context.log.debug(
      "%s",
      CommentRecorderHandler.newInvalidCommentIdMessage(commentId)
    )
    return HookOutput.none()
  }

  const { state } = review,
    next: ReviewState = {
      ...state,
      comments: ReviewStateText.appendCommentRecord(
        state.comments,
        commentId as string,
        {
          lastAction,
          revision: state.revision,
          at: context.now().toISOString()
        }
      )
    }

  await context.store.save(next)
  return HookOutput.none()
}

/**
 * Records what the model did to a Doc comment thread: the id of the revision
 * log comment when one is created, and the last action taken on every thread
 * it replies to or resolves. The revision-log thread is recognized by the
 * configured reply prefix, which is the prefix the protocol told the model to
 * open that comment with. A response the parsers do not recognize is
 * ignored — comment bookkeeping is diagnostic, never a gate.
 *
 * @param input The `PostToolUse` payload of the `manage_document_comment` call.
 * @param context Store, clock and logger.
 * @returns Nothing; this handler only records.
 */
export async function handleCommentRecorder(
  input: PostToolUseHookInput,
  context: HookContext
): HandlerResult {
  const review = await locateReview(input, context)
  if (review == null || review.state == null) {
    return HookOutput.none()
  }

  const { action } = input.tool_input,
    responseText = readToolResponseText(input.tool_response)

  return await match(action)
    .with(DocumentCommentAction.create, () =>
      recordCreatedComment(input, context, review, responseText)
    )
    .with(DocumentCommentAction.reply, () =>
      recordCommentAction(input, context, review, CommentAction.reply)
    )
    .with(DocumentCommentAction.resolve, () =>
      recordCommentAction(input, context, review, CommentAction.resolve)
    )
    .otherwise(() => HookOutput.none())
}
