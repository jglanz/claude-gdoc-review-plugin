/**
 * Suffix of a workspace-mcp tool the plugin knows about. Claude Code exposes
 * every MCP tool as `mcp__<server>__<suffix>`, and the server instance name is
 * whatever the user configured, so the plugin matches on the suffix only.
 */
export enum WorkspaceToolName {
  update_drive_file = "update_drive_file",
  import_to_google_doc = "import_to_google_doc",
  manage_document_comment = "manage_document_comment",
  create_drive_folder = "create_drive_folder",
  list_document_comments = "list_document_comments",
  get_doc_as_markdown = "get_doc_as_markdown",
  search_drive_files = "search_drive_files",
  list_drive_items = "list_drive_items",
  get_drive_shareable_link = "get_drive_shareable_link"
}

/** The `action` argument of the workspace-mcp `manage_document_comment` tool. */
export enum DocumentCommentAction {
  create = "create",
  reply = "reply",
  resolve = "resolve"
}

/** An `mcp__<server>__<tool>` tool name split into its server instance and the workspace-mcp tool it targets. */
export interface WorkspaceToolRef {
  /** Name of the connected MCP server instance, taken verbatim from the tool name. */
  serverName: string
  /** The workspace-mcp tool the call targets. */
  tool: WorkspaceToolName
}

const AllWorkspaceToolNames: WorkspaceToolName[] = [
  WorkspaceToolName.update_drive_file,
  WorkspaceToolName.import_to_google_doc,
  WorkspaceToolName.manage_document_comment,
  WorkspaceToolName.create_drive_folder,
  WorkspaceToolName.list_document_comments,
  WorkspaceToolName.get_doc_as_markdown,
  WorkspaceToolName.search_drive_files,
  WorkspaceToolName.list_drive_items,
  WorkspaceToolName.get_drive_shareable_link
]

/** Constants and parsing helpers of {@link WorkspaceToolName}. */
export namespace WorkspaceToolName {
  /** Prefix Claude Code puts in front of every MCP tool name. */
  export const Prefix = "mcp__"

  /** Separator between the server instance name and the tool name. */
  export const Separator = "__"

  /** Every known workspace-mcp tool, in declaration order. */
  export const All: readonly WorkspaceToolName[] = AllWorkspaceToolNames

  /** The tools that mutate Drive or Docs state and therefore need a permission decision from the plugin. */
  export const WriteTools: readonly WorkspaceToolName[] = [
    WorkspaceToolName.update_drive_file,
    WorkspaceToolName.import_to_google_doc,
    WorkspaceToolName.manage_document_comment,
    WorkspaceToolName.create_drive_folder
  ]

  /** Matches a full MCP tool name for any server instance, capturing the server name and the tool suffix. */
  export const Pattern = new RegExp(
    `^${Prefix}(.+)${Separator}(${AllWorkspaceToolNames.join("|")})$`
  )

  /**
   * Splits a full MCP tool name into its server instance and workspace-mcp tool.
   *
   * @param toolName full tool name as Claude Code reports it to a hook
   * @returns the parsed reference, or `null` when the name is not a workspace-mcp tool the plugin knows
   */
  export function parse(toolName: string): WorkspaceToolRef {
    if (toolName == null) {
      return null
    }
    const matched = Pattern.exec(toolName)
    if (matched == null) {
      return null
    }
    const [, serverName, tool] = matched
    return { serverName, tool: tool as WorkspaceToolName }
  }

  /**
   * Reports whether a tool mutates Drive or Docs state.
   *
   * @param tool the workspace-mcp tool to classify
   * @returns true for the write tools, false for the read-only ones and for unknown values
   */
  export function isWriteTool(tool: WorkspaceToolName): boolean {
    return WriteTools.includes(tool)
  }
}
