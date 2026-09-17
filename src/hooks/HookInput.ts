import { z } from "zod"

import { NestedError } from "../errors/index.js"

/**
 * The hook events this plugin subscribes to in `hooks/hooks.json`. Claude Code
 * spells the event in the `hook_event_name` field of every stdin payload, and
 * it is the discriminator of {@link HookInputSchema}.
 */
export enum HookEventName {
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  PermissionRequest = "PermissionRequest",
  SessionStart = "SessionStart"
}

/**
 * The built-in Claude Code tools the plugin reacts to by name. Every other
 * gated tool is an MCP tool, matched through
 * {@link WorkspaceToolName.parse} instead of this enum.
 */
export enum HostToolName {
  ExitPlanMode = "ExitPlanMode",
  Bash = "Bash",
  AskUserQuestion = "AskUserQuestion"
}

/**
 * Fields every hook payload carries, whatever the event.
 *
 * Only the two the plugin cannot work without are required: the session id and
 * the transcript path are how a payload is tied to the plan under review.
 * Everything else is optional and, where its shape does not matter to the
 * schema, unvalidated — a payload that carries a field Claude Code has changed
 * the type of must still reach the `ExitPlanMode` gate, because a payload this
 * schema rejects is a plan the gate never sees. The handlers narrow what they
 * read: a `permission_mode` that is not the string `"plan"` fails the Bash
 * allow-list closed, and a `tool_use_id` that is not a string is recorded as
 * none.
 */
export const HookInputBaseSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string().optional(),
  permission_mode: z.unknown().optional()
})

/** A tool's arguments, exactly as the model sent them; values stay unvalidated. */
export const ToolInputSchema = z.record(z.string(), z.unknown())

/** Payload of a `PreToolUse` hook: the call the engine is about to permit. */
export const PreToolUseHookInputSchema = HookInputBaseSchema.extend({
  hook_event_name: z.literal(HookEventName.PreToolUse),
  tool_name: z.string(),
  tool_input: ToolInputSchema,
  tool_use_id: z.unknown().optional()
})

/** Payload of a `PostToolUse` hook: the call plus whatever the tool returned. */
export const PostToolUseHookInputSchema = HookInputBaseSchema.extend({
  hook_event_name: z.literal(HookEventName.PostToolUse),
  tool_name: z.string(),
  tool_input: ToolInputSchema,
  tool_use_id: z.unknown().optional(),
  tool_response: z.unknown()
})

/** Payload of a `PermissionRequest` hook: the prompt the user would have answered. */
export const PermissionRequestHookInputSchema = HookInputBaseSchema.extend({
  hook_event_name: z.literal(HookEventName.PermissionRequest),
  tool_name: z.string(),
  tool_input: ToolInputSchema,
  tool_use_id: z.unknown().optional(),
  permission_suggestions: z.array(z.unknown()).optional()
})

/** Payload of a `SessionStart` hook: a session being started, resumed or compacted. */
export const SessionStartHookInputSchema = HookInputBaseSchema.extend({
  hook_event_name: z.literal(HookEventName.SessionStart),
  source: z.string().optional()
})

/** A `PreToolUse` payload, as validated by {@link PreToolUseHookInputSchema}. */
export interface PreToolUseHookInput extends z.infer<
  typeof PreToolUseHookInputSchema
> {}

/** A `PostToolUse` payload, as validated by {@link PostToolUseHookInputSchema}. */
export interface PostToolUseHookInput extends z.infer<
  typeof PostToolUseHookInputSchema
> {}

/** A `PermissionRequest` payload, as validated by {@link PermissionRequestHookInputSchema}. */
export interface PermissionRequestHookInput extends z.infer<
  typeof PermissionRequestHookInputSchema
> {}

/** A `SessionStart` payload, as validated by {@link SessionStartHookInputSchema}. */
export interface SessionStartHookInput extends z.infer<
  typeof SessionStartHookInputSchema
> {}

/** Every payload the plugin accepts on stdin, discriminated by `hook_event_name`. */
export const HookInputSchema = z.discriminatedUnion("hook_event_name", [
  PreToolUseHookInputSchema,
  PostToolUseHookInputSchema,
  PermissionRequestHookInputSchema,
  SessionStartHookInputSchema
])

/** One validated hook payload; narrow it on `hook_event_name`. */
export type HookInput = z.infer<typeof HookInputSchema>

/** Constants of the hook input codec. */
export namespace HookInputCodec {
  /** Message of the error thrown for a payload that is not a known hook event. */
  export const InvalidPayloadMessage = "Hook input failed validation"
}

/**
 * Validates an untrusted stdin payload.
 *
 * @param json Parsed JSON read from the hook's stdin.
 * @returns The validated payload, narrowed by its event.
 */
export function parseHookInput(json: unknown): HookInput {
  const result = HookInputSchema.safeParse(json)
  if (!result.success) {
    throw new NestedError(HookInputCodec.InvalidPayloadMessage, {
      cause: result.error,
      context: { issues: result.error.issues }
    })
  }
  return result.data
}
