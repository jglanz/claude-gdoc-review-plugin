import { match } from "ts-pattern"

import {
  ApproveAutoMode,
  resolveApproveAutoPermissionMode
} from "../config/index.js"
import { ReviewDecisionChoice } from "../state/index.js"
import { isRecord } from "../utils/index.js"
import { PermissionMode, PermissionUpdateType } from "./HookOutput.js"

/** What the approval mode is derived from. */
export interface ApprovalModeInput {
  /** The recorded menu choice. */
  choice: ReviewDecisionChoice

  /** Mode configured for "Approve and Use Auto Mode". */
  approveAutoMode: ApproveAutoMode

  /** `permission_suggestions` of the prompt, when the event carried them. */
  permissionSuggestions?: unknown[]
}

/** Constants and helpers of the approval-mode resolution. */
export namespace ApprovalMode {
  /** Mode used when the configured one is not offered by the prompt. */
  export const Fallback = PermissionMode.acceptEdits
}

function offersAutoMode(permissionSuggestions: unknown[]): boolean {
  return (
    Array.isArray(permissionSuggestions) &&
    permissionSuggestions.some(
      suggestion =>
        isRecord(suggestion) &&
        suggestion.type === PermissionUpdateType.setMode &&
        suggestion.mode === PermissionMode.auto
    )
  )
}

function resolveAutoMode(input: ApprovalModeInput): PermissionMode {
  const { approveAutoMode, permissionSuggestions } = input,
    requested = resolveApproveAutoPermissionMode(approveAutoMode)

  return match(requested)
    .with(PermissionMode.auto, () =>
      offersAutoMode(permissionSuggestions)
        ? PermissionMode.auto
        : ApprovalMode.Fallback
    )
    .otherwise(() => requested)
}

/**
 * Maps a recorded approval onto the permission mode the session switches into:
 * `Approve Manual Mode` is the engine's `default` mode, `Approve and Use Auto
 * Mode` is whatever the configuration asks for — falling back to `acceptEdits`
 * when `auto` is configured but the prompt does not offer it.
 *
 * @param input Choice, configuration and the prompt's suggestions.
 * @returns The mode to request, or `null` when the choice is not an approval.
 */
export function resolveApprovalMode(input: ApprovalModeInput): PermissionMode {
  const { choice } = input
  return match(choice)
    .with(ReviewDecisionChoice.approve_manual, () => PermissionMode.default)
    .with(ReviewDecisionChoice.approve_auto, () => resolveAutoMode(input))
    .otherwise(() => null)
}
