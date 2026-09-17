import path from "node:path"

import { extractDocumentId, WorkspaceToolName } from "../../google/index.js"
import type { ReviewDoc, ReviewState } from "../../state/index.js"
import { ReviewStatus } from "../../state/index.js"
import { isNonEmptyString, isString } from "../../utils/index.js"
import type { HookContext } from "../HookContext.js"
import type { PreToolUseHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import { locateReview } from "../ReviewLookup.js"
import type { HandlerResult } from "./HandlerResult.js"

/** Constants of the workspace-mcp write gate. */
export namespace McpWriteToolHandler {
  /** Reason attached to a call allowed because it belongs to an active review. */
  export const AllowReason =
    "gdoc-review: call targets the Doc of an active review"

  /**
   * The one `permission_mode` in which this gate grants anything. Plan mode is
   * the mode that refuses an MCP write outright ("Cannot call X while in plan
   * mode"), and it is the mode a review round runs in; outside it the user's
   * ordinary permission settings already decide, and auto-allowing would only
   * widen what an unattended session can write.
   */
  export const PlanPermissionMode = "plan"

  /** Statuses whose Doc may still be written to. */
  export const DocumentWriteStatuses: readonly ReviewStatus[] = [
    ReviewStatus.active,
    ReviewStatus.approved
  ]

  /** Tool-input parameter naming the Drive file an `update_drive_file` call writes. */
  export const FileIdParameter = "file_id"

  /** Tool-input parameter naming the Doc a `manage_document_comment` call writes. */
  export const DocumentIdParameter = "document_id"

  /**
   * Tool-input parameter naming a local file the server reads instead of the
   * inline content — the `file_path` sync mode.
   */
  export const FilePathParameter = "file_path"

  /**
   * Tool-input parameters that make the server read the new content from
   * somewhere other than the call itself. Neither belongs to a plan sync, and
   * `file_url` would have the server fetch a URL, so a call setting either is
   * left to the ordinary permission prompt.
   */
  export const ForeignContentParameters: readonly string[] = [
    "file_url",
    "base64_content"
  ]

  /**
   * The one parameter that names the target document, per write tool.
   *
   * The gate reads the target from this parameter alone: a tool the table does
   * not name is never auto-allowed, and a decoy reference in another parameter
   * cannot be the one that is compared against the registered Doc.
   */
  export const TargetParameterByTool: Readonly<Record<string, string>> = {
    [WorkspaceToolName.update_drive_file]: FileIdParameter,
    [WorkspaceToolName.manage_document_comment]: DocumentIdParameter
  }

  /**
   * Every parameter that can carry a document reference. All of the ones a
   * payload actually sets must normalise to the target id, so a second
   * reference cannot smuggle a different document past the check.
   */
  export const DocumentReferenceParameters: readonly string[] = [
    FileIdParameter,
    DocumentIdParameter
  ]
}

function readParameterDocumentId(
  toolInput: PreToolUseHookInput["tool_input"],
  parameter: string
): string {
  const { [parameter]: value } = toolInput
  return isString(value) ? extractDocumentId(value) : null
}

function readTargetDocumentId(
  tool: WorkspaceToolName,
  toolInput: PreToolUseHookInput["tool_input"]
): string {
  const { [tool]: parameter } = McpWriteToolHandler.TargetParameterByTool
  return isNonEmptyString(parameter)
    ? readParameterDocumentId(toolInput, parameter)
    : null
}

function referencesOnlyTarget(
  toolInput: PreToolUseHookInput["tool_input"],
  documentId: string
): boolean {
  return McpWriteToolHandler.DocumentReferenceParameters.every(parameter => {
    const { [parameter]: value } = toolInput
    return (
      value == null ||
      readParameterDocumentId(toolInput, parameter) === documentId
    )
  })
}

/**
 * Reports whether a payload's `file_path`, when it sets one, names the plan
 * file of this review, and that no other parameter hands the server content
 * from somewhere else.
 *
 * The `file_path` sync mode has the server read a local file and write it into
 * the Doc, so the parameter decides which of the machine's files leaves it. A
 * path this review does not own is not a sync of the plan, and `file_url` or
 * `base64_content` is not a sync of the plan at all; both are left to the
 * ordinary permission prompt.
 */
function writesOnlyThePlanFile(
  toolInput: PreToolUseHookInput["tool_input"],
  planFile: string
): boolean {
  const { [McpWriteToolHandler.FilePathParameter]: filePath } = toolInput

  if (
    McpWriteToolHandler.ForeignContentParameters.some(
      parameter => toolInput[parameter] != null
    )
  ) {
    return false
  }
  if (filePath == null) {
    return true
  }
  return (
    isNonEmptyString(filePath) &&
    isNonEmptyString(planFile) &&
    path.resolve(filePath) === path.resolve(planFile)
  )
}

function targetsRegisteredDocument(
  doc: ReviewDoc,
  serverName: string,
  tool: WorkspaceToolName,
  toolInput: PreToolUseHookInput["tool_input"]
): boolean {
  return (
    serverName === doc.serverName &&
    readTargetDocumentId(tool, toolInput) === doc.id &&
    referencesOnlyTarget(toolInput, doc.id)
  )
}

function allowForRegisteredDocument(
  state: ReviewState,
  serverName: string,
  tool: WorkspaceToolName,
  toolInput: PreToolUseHookInput["tool_input"],
  planFile: string
): HookOutput.Any {
  const { doc } = state
  if (
    doc == null ||
    !McpWriteToolHandler.DocumentWriteStatuses.includes(state.status)
  ) {
    return HookOutput.none()
  }

  return targetsRegisteredDocument(doc, serverName, tool, toolInput) &&
    writesOnlyThePlanFile(toolInput, planFile)
    ? HookOutput.preToolUseAllow(McpWriteToolHandler.AllowReason)
    : HookOutput.none()
}

/**
 * Allows the two workspace-mcp writes a review round makes against its own Doc,
 * which plan mode would otherwise refuse ("Cannot call X while in plan mode").
 * Every other call — including the folder and Doc creation of `/gdoc-review`
 * setup — is left to Claude Code's normal permission flow, so the user is asked
 * once, before anything is created in their Drive.
 *
 * The grant is the narrowest statement the plugin can make: this is a write, in
 * plan mode, to the Doc the user registered, on the MCP server that Doc was
 * registered through, for a review that is `active` or `approved`. The tool's
 * own target parameter must resolve to the registered Doc, every other document
 * reference in the payload must resolve to the same id, and an
 * `update_drive_file` that names a `file_path` must name this review's own plan
 * file and must not also hand the server a URL or a base64 body.
 *
 * @param input The `PreToolUse` payload of the MCP call.
 * @param context Store and locator.
 * @returns An allow for a round write against the registered Doc, nothing otherwise.
 */
export async function handleMcpWriteTool(
  input: PreToolUseHookInput,
  context: HookContext
): HandlerResult {
  const reference = WorkspaceToolName.parse(input.tool_name)
  if (
    reference == null ||
    McpWriteToolHandler.TargetParameterByTool[reference.tool] == null ||
    input.permission_mode !== McpWriteToolHandler.PlanPermissionMode
  ) {
    return HookOutput.none()
  }

  const review = await locateReview(input, context)
  if (review == null || review.state == null) {
    return HookOutput.none()
  }

  const { state, planFile } = review,
    { tool, serverName } = reference,
    { tool_input: toolInput } = input

  return allowForRegisteredDocument(
    state,
    serverName,
    tool,
    toolInput,
    planFile
  )
}
