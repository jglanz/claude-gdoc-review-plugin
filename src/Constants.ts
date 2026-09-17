/**
 * Plugin-wide constants. Every meaningful literal the plugin writes into a
 * filesystem path, a Doc comment or a menu lives here, so a spelling exists in
 * exactly one place and both the runtime and the tests reference the identifier.
 */
export namespace GDocReview {
  /** Plugin identifier — matches `.claude-plugin/plugin.json` and the package name. */
  export const PluginName = "claude-gdoc-review-plugin"

  /** Directory under the Claude config dir holding review state, config and the log. */
  export const StateDirName = "gdoc-review"

  /** Prefix marking a Doc comment reply as written by the agent rather than a human. */
  export const ReplyPrefix = "🤖"

  /** Header of the custom approval menu presented in place of the built-in dialog. */
  export const MenuHeader = "GDoc Review"

  /** Environment variable Claude Code sets to the installed plugin's root. */
  export const PluginRootEnvironmentKey = "CLAUDE_PLUGIN_ROOT"

  /** Words following the reply prefix in the revision-log comment. */
  export const RevisionLogTitle = "Revision log"

  /**
   * Builds the marker opening the revision-log comment for a configured reply
   * prefix, so a plugin configured with its own prefix recognizes the thread it
   * told the model to create.
   *
   * @param replyPrefix Prefix the agent puts in front of everything it writes.
   * @returns The marker the revision-log comment starts with.
   */
  export function newRevisionLogMarker(replyPrefix: string): string {
    return `${replyPrefix} ${RevisionLogTitle}`
  }

  /** Marker opening the revision-log comment under the default reply prefix. */
  export const RevisionLogMarker = newRevisionLogMarker(ReplyPrefix)

  /**
   * Printed instead of a recorded Doc link that is not a canonical Google Docs
   * URL, so an arbitrary address cannot be echoed into the model's context or
   * into a message the user reads.
   */
  export const UntrustedDocUrlNotice =
    "(link withheld: the registered Doc link is not a canonical Google Docs URL)"
}
