/** Lifecycle of a review: created by `init`, `active` once the Doc is registered, terminal states after approval or cancellation. */
export enum ReviewStatus {
  setup = "setup",
  active = "active",
  approved = "approved",
  cancelled = "cancelled"
}

/** The user's choice on the "GDoc Review" menu, captured by the AskUserQuestion PostToolUse hook or the `decision` command. */
export enum ReviewDecisionChoice {
  approve_auto = "approve_auto",
  approve_manual = "approve_manual",
  check_doc = "check_doc",
  other = "other"
}

/** Where the Doc lives: the user's My Drive or a named Shared Drive. */
export enum DriveKind {
  personal = "personal",
  shared = "shared"
}

/** How the plan text reaches `update_drive_file`: inline `content` (default) or a server-readable `file_path`. */
export enum SyncMode {
  content = "content",
  file_path = "file_path"
}

/**
 * Last thing the plugin did to a Doc comment thread, recorded per comment id.
 *
 * Creating the revision-log thread is not one of them: that comment is recorded
 * by its id in `logCommentId`, not as a per-thread action.
 */
export enum CommentAction {
  reply = "reply",
  resolve = "resolve"
}

/**
 * Permission mode a plan approval switches the session into.
 *
 * It lives beside the review enums rather than with the hook output types
 * because the persisted `approvedMode` is one of these values: the state schema
 * validates against this enum, and the hook layer re-exports it so a hook
 * result and a recorded approval can never drift apart.
 */
export enum PermissionMode {
  acceptEdits = "acceptEdits",
  default = "default",
  auto = "auto"
}

/**
 * Where a recorded decision came from.
 *
 * Only an `ask_user_question` decision is evidence that the user personally
 * picked a row on the review menu, so only that source may skip the built-in
 * approval dialog. A `cli` decision was written by a command the model can
 * reach, so it is recorded but never auto-approved.
 */
export enum ReviewDecisionSource {
  ask_user_question = "ask_user_question",
  cli = "cli"
}
