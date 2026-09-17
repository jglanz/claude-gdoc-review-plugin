import { match } from "ts-pattern"

import { WorkspaceToolName } from "../google/index.js"
import type { HookContext } from "./HookContext.js"
import type {
  HookInput,
  PermissionRequestHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput
} from "./HookInput.js"
import { HookEventName, HostToolName } from "./HookInput.js"
import { HookOutput } from "./HookOutput.js"
import { handleBashAllowlist } from "./handlers/BashAllowlistHandler.js"
import { handleCommentRecorder } from "./handlers/CommentRecorderHandler.js"
import { handleDecisionCapture } from "./handlers/DecisionCaptureHandler.js"
import { handleExitPlanModeCompletion } from "./handlers/ExitPlanModeCompletionHandler.js"
import { handleExitPlanModeGate } from "./handlers/ExitPlanModeGateHandler.js"
import type { HandlerResult } from "./handlers/HandlerResult.js"
import { handleMcpWriteTool } from "./handlers/McpWriteToolHandler.js"
import { handlePermissionRequest } from "./handlers/PermissionRequestHandler.js"
import { handleSessionStart } from "./handlers/SessionStartHandler.js"
import { handleSyncRecorder } from "./handlers/SyncRecorderHandler.js"

/** Constants of the hook dispatcher. */
export namespace HookDispatcher {
  /** Message logged when a handler throws; the hook still prints nothing. */
  export const HandlerFailureMessage = "gdoc-review hook handler failed"
}

/** Runs one handler for a payload the dispatcher already routed. */
type HandlerRun = () => HandlerResult

async function runGuarded(
  context: HookContext,
  run: HandlerRun
): HandlerResult {
  try {
    return await run()
  } catch (cause) {
    context.log.error(
      "%s: %s",
      HookDispatcher.HandlerFailureMessage,
      cause instanceof Error ? cause.message : String(cause)
    )
    return HookOutput.none()
  }
}

function dispatchPreToolUse(
  input: PreToolUseHookInput,
  context: HookContext
): HandlerResult {
  return match(input.tool_name)
    .with(HostToolName.ExitPlanMode, () =>
      handleExitPlanModeGate(input, context)
    )
    .with(HostToolName.Bash, () => handleBashAllowlist(input, context))
    .otherwise(() => handleMcpWriteTool(input, context))
}

function dispatchPostToolUseMcp(
  input: PostToolUseHookInput,
  context: HookContext
): HandlerResult {
  const reference = WorkspaceToolName.parse(input.tool_name)
  if (reference == null) {
    return Promise.resolve(HookOutput.none())
  }

  return match(reference.tool)
    .with(
      WorkspaceToolName.update_drive_file,
      WorkspaceToolName.import_to_google_doc,
      () => handleSyncRecorder(input, context)
    )
    .with(WorkspaceToolName.manage_document_comment, () =>
      handleCommentRecorder(input, context)
    )
    .otherwise(() => Promise.resolve(HookOutput.none()))
}

function dispatchPostToolUse(
  input: PostToolUseHookInput,
  context: HookContext
): HandlerResult {
  return match(input.tool_name)
    .with(HostToolName.AskUserQuestion, () =>
      handleDecisionCapture(input, context)
    )
    .with(HostToolName.ExitPlanMode, () =>
      handleExitPlanModeCompletion(input, context)
    )
    .otherwise(() => dispatchPostToolUseMcp(input, context))
}

function dispatchPermissionRequest(
  input: PermissionRequestHookInput,
  context: HookContext
): HandlerResult {
  return match(input.tool_name)
    .with(HostToolName.ExitPlanMode, () =>
      handlePermissionRequest(input, context)
    )
    .otherwise(() => Promise.resolve(HookOutput.none()))
}

/**
 * Routes one validated payload to its handler: first on the hook event, then
 * on the tool the event is about.
 *
 * Every handler runs inside a guard, because a hook that throws — or prints a
 * stack trace — breaks the session it was meant to help: a failure is logged
 * to `log.jsonl` and answered with "print nothing", which leaves the engine's
 * own behaviour in place.
 *
 * @param input The validated hook payload.
 * @param context Dependencies the handlers run against.
 * @returns The hook result to print, or `null` for "print nothing".
 */
export async function dispatchHook(
  input: HookInput,
  context: HookContext
): HandlerResult {
  return await match(input)
    .with({ hook_event_name: HookEventName.PreToolUse }, preToolUse =>
      runGuarded(context, () => dispatchPreToolUse(preToolUse, context))
    )
    .with({ hook_event_name: HookEventName.PostToolUse }, postToolUse =>
      runGuarded(context, () => dispatchPostToolUse(postToolUse, context))
    )
    .with(
      { hook_event_name: HookEventName.PermissionRequest },
      permissionRequest =>
        runGuarded(context, () =>
          dispatchPermissionRequest(permissionRequest, context)
        )
    )
    .with({ hook_event_name: HookEventName.SessionStart }, sessionStart =>
      runGuarded(context, () => handleSessionStart(sessionStart, context))
    )
    .exhaustive()
}
