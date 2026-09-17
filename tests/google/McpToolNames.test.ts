import {
  DocumentCommentAction,
  WorkspaceToolName
} from "claude-gdoc-review-plugin"

const ServerName = "workspace",
  newToolName = (tool: string) =>
    `${WorkspaceToolName.Prefix}${ServerName}${WorkspaceToolName.Separator}${tool}`

describe("WorkspaceToolName", () => {
  it("maps every tool member to its own suffix", () => {
    WorkspaceToolName.All.forEach(tool =>
      expect(WorkspaceToolName[tool]).toBe(tool)
    )
  })

  it("carries every tool the plugin calls", () => {
    expect([...WorkspaceToolName.All].sort()).toEqual(
      [
        WorkspaceToolName.create_drive_folder,
        WorkspaceToolName.get_doc_as_markdown,
        WorkspaceToolName.get_drive_shareable_link,
        WorkspaceToolName.import_to_google_doc,
        WorkspaceToolName.list_document_comments,
        WorkspaceToolName.list_drive_items,
        WorkspaceToolName.manage_document_comment,
        WorkspaceToolName.search_drive_files,
        WorkspaceToolName.update_drive_file
      ].sort()
    )
  })

  describe("parse", () => {
    it("splits a full MCP tool name into server and tool", () => {
      expect(
        WorkspaceToolName.parse(
          newToolName(WorkspaceToolName.update_drive_file)
        )
      ).toEqual({
        serverName: ServerName,
        tool: WorkspaceToolName.update_drive_file
      })
    })

    it("accepts a server name that itself contains the separator", () => {
      const parsed = WorkspaceToolName.parse(
        `${WorkspaceToolName.Prefix}my__google${WorkspaceToolName.Separator}${WorkspaceToolName.manage_document_comment}`
      )
      expect(parsed.serverName).toBe("my__google")
      expect(parsed.tool).toBe(WorkspaceToolName.manage_document_comment)
    })

    it("returns null for a non-MCP tool, an unknown suffix and a missing name", () => {
      expect(WorkspaceToolName.parse("Bash")).toBeNull()
      expect(
        WorkspaceToolName.parse(newToolName("delete_everything"))
      ).toBeNull()
      expect(
        WorkspaceToolName.parse(
          `${WorkspaceToolName.Prefix}${WorkspaceToolName.update_drive_file}`
        )
      ).toBeNull()
      expect(WorkspaceToolName.parse(null)).toBeNull()
    })
  })

  describe("isWriteTool", () => {
    it("classifies the mutating tools as writes", () => {
      expect(
        WorkspaceToolName.WriteTools.every(tool =>
          WorkspaceToolName.isWriteTool(tool)
        )
      ).toBe(true)
    })

    it("classifies read-only tools and unknown values as non-writes", () => {
      expect(
        WorkspaceToolName.isWriteTool(WorkspaceToolName.list_document_comments)
      ).toBe(false)
      expect(
        WorkspaceToolName.isWriteTool(WorkspaceToolName.search_drive_files)
      ).toBe(false)
      expect(WorkspaceToolName.isWriteTool(null)).toBe(false)
    })
  })
})

describe("DocumentCommentAction", () => {
  it("maps every action to its own name", () => {
    Object.entries(DocumentCommentAction).forEach(([key, value]) =>
      expect(value).toBe(key)
    )
  })

  it("carries exactly the three actions the protocol uses", () => {
    expect(Object.keys(DocumentCommentAction)).toEqual([
      "create",
      "reply",
      "resolve"
    ])
  })
})
