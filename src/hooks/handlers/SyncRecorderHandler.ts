import path from "node:path"

import { match } from "ts-pattern"

import {
  extractDocumentId,
  isDocumentId,
  parseImportedDocument,
  parseUpdatedFile,
  ToolResponseParsers,
  WorkspaceToolName
} from "../../google/index.js"
import { sha256OfFile, sha256OfText } from "../../plan/index.js"
import {
  ReviewState,
  ReviewStateText,
  ReviewStatus
} from "../../state/index.js"
import { isNonEmptyString, isString } from "../../utils/index.js"
import type { HookContext } from "../HookContext.js"
import type { PostToolUseHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import type { ReviewLookup } from "../ReviewLookup.js"
import { locateReview } from "../ReviewLookup.js"
import { readToolResponseText } from "../ToolResponseText.js"
import type { HandlerResult } from "./HandlerResult.js"

/** Constants and message builders of the sync recorder. */
export namespace SyncRecorderHandler {
  /** Prefix of every context line this handler adds. */
  export const MessagePrefix = "gdoc-review:"

  /**
   * States that the Doc now holds the current plan text.
   *
   * @param revision Revision the sync produced.
   * @returns The context line added after a recorded sync.
   */
  export function newSyncedMessage(revision: number): string {
    return `${MessagePrefix} revision ${revision} synced`
  }

  /**
   * States that the synced text is not the plan text, so the sync was not
   * recorded and the gate will demand the round again.
   *
   * @param planFile Absolute path of the plan markdown file.
   * @returns The context line added after a mismatched sync.
   */
  export function newContentMismatchMessage(planFile: string): string {
    return `${MessagePrefix} the content you synced differs from the plan file, so this revision was NOT recorded. Re-read ${planFile} and call update_drive_file again with its exact, complete text.`
  }

  /**
   * States that the plan file has no text to pin the revision to, so the sync
   * could not be recorded.
   *
   * @param planFile Absolute path of the plan markdown file.
   * @returns The context line added when the plan file is missing.
   */
  export function newMissingPlanMessage(planFile: string): string {
    return `${MessagePrefix} ${planFile} could not be read, so this revision was NOT recorded. Write the plan file, then call update_drive_file again with its exact, complete text.`
  }

  /**
   * Reports an import response whose `Document ID:` line is not a Drive file
   * id, so no Doc was registered from it.
   *
   * @param documentId The value the response carried on that line.
   * @returns The warning written to the log.
   */
  export function newInvalidDocumentIdMessage(documentId: string): string {
    return `Import response named ${documentId}, which is not a Google Drive file id; no Doc registered`
  }
}

async function recordImportedDocument(
  input: PostToolUseHookInput,
  context: HookContext,
  review: ReviewLookup,
  responseText: string,
  serverName: string
): HandlerResult {
  const { state } = review
  if (state.status !== ReviewStatus.setup) {
    return HookOutput.none()
  }

  const imported = parseImportedDocument(responseText)
  if (imported == null) {
    context.log.debug("Import response carried no document id")
    return HookOutput.none()
  }

  const { documentId } = imported
  if (!isDocumentId(documentId)) {
    context.log.warn(
      "%s",
      SyncRecorderHandler.newInvalidDocumentIdMessage(documentId)
    )
    return HookOutput.none()
  }

  const { file_name: fileName } = input.tool_input,
    title = ReviewStateText.sanitizeText(
      fileName,
      ReviewStateText.MaxTitleLength
    ),
    next: ReviewState = {
      ...state,
      doc: {
        id: documentId.trim(),
        url: ToolResponseParsers.newDocumentUrl(documentId.trim()),
        title: isNonEmptyString(title) ? title : review.planSlug,
        serverName
      }
    }

  await context.store.save(next)
  return HookOutput.none()
}

function targetsRegisteredDocument(
  input: PostToolUseHookInput,
  state: ReviewState
): boolean {
  const { file_id: fileId } = input.tool_input
  return (
    state.doc != null &&
    isString(fileId) &&
    extractDocumentId(fileId) === state.doc.id
  )
}

/**
 * Decides whether an `update_drive_file` call actually put the plan text into
 * the Doc.
 *
 * `content` mode is decided by digest. `file_path` mode carries no text at all,
 * so the only thing the hook can check is that the path the server was told to
 * read is the plan file itself — any other path is a sync of something else and
 * must not open the gate.
 */
function syncedThePlan(
  input: PostToolUseHookInput,
  planFile: string,
  planSha256: string
): boolean {
  const { content, file_path: filePath } = input.tool_input

  if (isString(content)) {
    return sha256OfText(content) === planSha256
  }
  return (
    isNonEmptyString(filePath) &&
    path.resolve(String(filePath)) === path.resolve(planFile)
  )
}

async function recordUpdatedFile(
  input: PostToolUseHookInput,
  context: HookContext,
  review: ReviewLookup,
  responseText: string
): HandlerResult {
  const { state, planFile } = review,
    { success } = parseUpdatedFile(responseText)

  if (!success || !targetsRegisteredDocument(input, state)) {
    return HookOutput.none()
  }

  const planSha256 = await sha256OfFile(planFile)
  if (!isNonEmptyString(planSha256)) {
    context.log.warn("No plan text to pin the sync to at %s", planFile)
    return HookOutput.postToolUseContext(
      SyncRecorderHandler.newMissingPlanMessage(planFile)
    )
  }

  if (!syncedThePlan(input, planFile, planSha256)) {
    context.log.warn(
      "Synced content does not match %s; sync not recorded",
      planFile
    )
    return HookOutput.postToolUseContext(
      SyncRecorderHandler.newContentMismatchMessage(planFile)
    )
  }

  const revision = state.revision + 1,
    next: ReviewState = {
      ...state,
      revision,
      lastSync: {
        at: context.now().toISOString(),
        planSha256,
        revision
      }
    }

  await context.store.save(next)
  return HookOutput.postToolUseContext(
    SyncRecorderHandler.newSyncedMessage(revision)
  )
}

/**
 * Records what a write to Drive did to the review.
 *
 * An `import_to_google_doc` during setup registers the Doc — it is not a plan
 * sync, because the imported text may be a placeholder written before the plan
 * existed. Recording it is not allowing it: the import itself goes through
 * Claude Code's own permission flow, and this hook only writes down what the
 * call turned out to create. The id it registers must be a Drive file id, the
 * link it records is rebuilt from that id, the title is stripped of control
 * characters and capped, and the MCP server the call was made on is recorded
 * with it — the response is text from outside this plugin, the recorded id and
 * server are what every later write is compared against, and the recorded link
 * is what reaches the model's context. An
 * `update_drive_file` against the registered Doc records
 * `lastSync`, but only when the synced text is the plan text — by digest in
 * `content` mode, and by the path the server was told to read in `file_path`
 * mode. Anything else, including a plan file that cannot be read, is answered
 * with an instruction to re-sync instead, leaving the gate closed.
 *
 * @param input The `PostToolUse` payload of the write call.
 * @param context Store, clock and logger.
 * @returns A context line for the model, or nothing.
 */
export async function handleSyncRecorder(
  input: PostToolUseHookInput,
  context: HookContext
): HandlerResult {
  const reference = WorkspaceToolName.parse(input.tool_name)
  if (reference == null) {
    return HookOutput.none()
  }

  const review = await locateReview(input, context)
  if (review == null || review.state == null) {
    return HookOutput.none()
  }

  const responseText = readToolResponseText(input.tool_response)
  return await match(reference.tool)
    .with(WorkspaceToolName.import_to_google_doc, () =>
      recordImportedDocument(
        input,
        context,
        review,
        responseText,
        reference.serverName
      )
    )
    .with(WorkspaceToolName.update_drive_file, () =>
      recordUpdatedFile(input, context, review, responseText)
    )
    .otherwise(() => HookOutput.none())
}
