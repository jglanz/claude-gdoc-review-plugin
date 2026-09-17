import { PermissionMode } from "../state/ReviewStateEnums.js"
import { HookEventName } from "./HookInput.js"

export { PermissionMode }

/** The two permission verdicts a `PreToolUse` hook may return. */
export enum PermissionDecision {
  allow = "allow",
  deny = "deny"
}

/** Behaviour of a `PermissionRequest` decision; the plugin only ever allows. */
export enum PermissionBehavior {
  allow = "allow"
}

/** Kind of permission update carried by a `PermissionRequest` decision. */
export enum PermissionUpdateType {
  setMode = "setMode"
}

/** Scope a permission update applies to. */
export enum PermissionUpdateDestination {
  session = "session"
}

/** Body of a `PreToolUse` hook result. */
export interface PreToolUseHookPayload {
  /** Event the payload belongs to; the engine rejects a mismatched name. */
  hookEventName: HookEventName.PreToolUse

  /** Verdict replacing the engine's own permission evaluation. */
  permissionDecision: PermissionDecision

  /** Text shown to the user and fed back to the model as the tool error on a deny. */
  permissionDecisionReason: string
}

/** A `PreToolUse` hook result. */
export interface PreToolUseHookOutput {
  /** The event-specific body. */
  hookSpecificOutput: PreToolUseHookPayload
}

/** Body of a `PostToolUse` hook result. */
export interface PostToolUseHookPayload {
  /** Event the payload belongs to. */
  hookEventName: HookEventName.PostToolUse

  /** Text appended to the model's context after the tool call. */
  additionalContext: string
}

/** A `PostToolUse` hook result. */
export interface PostToolUseHookOutput {
  /** The event-specific body. */
  hookSpecificOutput: PostToolUseHookPayload
}

/** One permission update applied when a `PermissionRequest` hook allows a call. */
export interface PermissionUpdate {
  /** Kind of update; the plugin only issues mode switches. */
  type: PermissionUpdateType

  /** Permission mode the session is switched into. */
  mode: PermissionMode

  /** Scope of the update; the plugin only ever changes the session. */
  destination: PermissionUpdateDestination
}

/** The decision a `PermissionRequest` hook answers the prompt with. */
export interface PermissionRequestDecision {
  /** Always `allow`: the plugin never denies through this event. */
  behavior: PermissionBehavior

  /** Permission updates applied together with the allow. */
  updatedPermissions: PermissionUpdate[]
}

/** Body of a `PermissionRequest` hook result. */
export interface PermissionRequestHookPayload {
  /** Event the payload belongs to. */
  hookEventName: HookEventName.PermissionRequest

  /** The answer replacing the built-in prompt. */
  decision: PermissionRequestDecision
}

/** A `PermissionRequest` hook result. */
export interface PermissionRequestHookOutput {
  /** The event-specific body. */
  hookSpecificOutput: PermissionRequestHookPayload
}

/** Body of a `SessionStart` hook result. */
export interface SessionStartHookPayload {
  /** Event the payload belongs to. */
  hookEventName: HookEventName.SessionStart

  /** Text added to the context of the starting session. */
  additionalContext: string
}

/** A `SessionStart` hook result. */
export interface SessionStartHookOutput {
  /** The event-specific body. */
  hookSpecificOutput: SessionStartHookPayload
}

/**
 * Builders of the JSON a hook prints on stdout. Every handler returns one of
 * these values — or `null`, which means "print nothing", i.e. leave the
 * engine's own behaviour untouched.
 */
export namespace HookOutput {
  /** Any result a handler may produce; `null` stands for "print nothing". */
  export type Any =
    | PreToolUseHookOutput
    | PostToolUseHookOutput
    | PermissionRequestHookOutput
    | SessionStartHookOutput

  /** Reason attached to an allow when the caller states none. */
  export const DefaultAllowReason = "Allowed by the gdoc-review plugin"

  /**
   * Builds the "print nothing" result.
   *
   * @returns `null`, so the hook stays silent and the engine decides.
   */
  export function none(): HookOutput.Any {
    return null
  }

  /**
   * Allows a `PreToolUse` call outright, skipping the permission prompt.
   *
   * @param reason Why the call is allowed; shown in the transcript.
   * @returns The `PreToolUse` allow result.
   */
  export function preToolUseAllow(
    reason: string = DefaultAllowReason
  ): PreToolUseHookOutput {
    return {
      hookSpecificOutput: {
        hookEventName: HookEventName.PreToolUse,
        permissionDecision: PermissionDecision.allow,
        permissionDecisionReason: reason
      }
    }
  }

  /**
   * Denies a `PreToolUse` call; the reason reaches the model as the tool error,
   * which is how the review round protocol is delivered.
   *
   * @param reason What the model must do instead.
   * @returns The `PreToolUse` deny result.
   */
  export function preToolUseDeny(reason: string): PreToolUseHookOutput {
    return {
      hookSpecificOutput: {
        hookEventName: HookEventName.PreToolUse,
        permissionDecision: PermissionDecision.deny,
        permissionDecisionReason: reason
      }
    }
  }

  /**
   * Adds context to the model after a tool call.
   *
   * @param additionalContext Text appended to the model's context.
   * @returns The `PostToolUse` result.
   */
  export function postToolUseContext(
    additionalContext: string
  ): PostToolUseHookOutput {
    return {
      hookSpecificOutput: {
        hookEventName: HookEventName.PostToolUse,
        additionalContext
      }
    }
  }

  /**
   * Answers a permission prompt with an allow plus the permission updates the
   * built-in dialog rows would have applied.
   *
   * @param updatedPermissions Updates applied with the allow; empty by default.
   * @returns The `PermissionRequest` result.
   */
  export function permissionRequestAllow(
    updatedPermissions: PermissionUpdate[] = []
  ): PermissionRequestHookOutput {
    return {
      hookSpecificOutput: {
        hookEventName: HookEventName.PermissionRequest,
        decision: {
          behavior: PermissionBehavior.allow,
          updatedPermissions
        }
      }
    }
  }

  /**
   * Builds the session-mode update a plan approval applies.
   *
   * @param mode Permission mode the session switches into.
   * @returns The `setMode` permission update.
   */
  export function newSetModeUpdate(mode: PermissionMode): PermissionUpdate {
    return {
      type: PermissionUpdateType.setMode,
      mode,
      destination: PermissionUpdateDestination.session
    }
  }

  /**
   * Adds context to a starting, resumed or compacted session.
   *
   * @param additionalContext Text added to the session's context.
   * @returns The `SessionStart` result.
   */
  export function sessionStartContext(
    additionalContext: string
  ): SessionStartHookOutput {
    return {
      hookSpecificOutput: {
        hookEventName: HookEventName.SessionStart,
        additionalContext
      }
    }
  }

  /**
   * Renders a result for stdout.
   *
   * @param output A result, or `null` for "print nothing".
   * @returns The JSON text to print, or `null` when nothing must be printed.
   */
  export function serialize(output: HookOutput.Any): string {
    return output == null ? null : JSON.stringify(output)
  }
}
