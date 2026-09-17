import path from "node:path"

import {
  handleMcpWriteTool,
  HookInput,
  McpWriteToolHandler,
  PermissionDecision,
  PreToolUseHookInput,
  PreToolUseHookOutput,
  ReviewStatus,
  WorkspaceToolName
} from "claude-gdoc-review-plugin"

import {
  createActiveReviewState,
  createHookInput,
  createHookTestEnvironment,
  destroyHookTestEnvironment,
  FixtureDocId,
  FixtureDocUrl,
  FixtureServerName,
  HookTestEnvironment,
  writePlanText
} from "../../support/hookTestSupport.js"

/** Prefix of the server the fixture review is registered against. */
const ServerPrefix = `mcp__${FixtureServerName}__`

/** A second connected workspace server — another Google account. */
const ForeignServerPrefix = "mcp__gworkspace-work__"

/** Another Doc id, used wherever a decoy reference is needed. */
const OtherDocumentId = "1SomeOtherDocumentIdAbCdEfGhIjKlMnOpQrSt"

function asPreToolUse(input: HookInput): PreToolUseHookInput {
  return input as PreToolUseHookInput
}

function mcpInput(
  environment: HookTestEnvironment,
  tool: WorkspaceToolName,
  toolInput: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): PreToolUseHookInput {
  return asPreToolUse(
    createHookInput(environment, "pre-tool-use-mcp-update-drive-file.json", {
      tool_name: `${ServerPrefix}${tool}`,
      tool_input: toolInput,
      ...overrides
    })
  )
}

describe("handleMcpWriteTool", () => {
  let environment: HookTestEnvironment = null

  beforeEach(async () => {
    environment = await createHookTestEnvironment()
    await writePlanText(environment, "# Fixture plan\n")
  })

  afterEach(async () => {
    await destroyHookTestEnvironment(environment)
  })

  it("allows a write to the registered Doc of an active review", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = asPreToolUse(
        createHookInput(environment, "pre-tool-use-mcp-update-drive-file.json")
      ),
      output = (await handleMcpWriteTool(
        input,
        environment.context
      )) as PreToolUseHookOutput

    expect(output.hookSpecificOutput.permissionDecision).toBe(
      PermissionDecision.allow
    )
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      McpWriteToolHandler.AllowReason
    )
  })

  it("accepts the Doc URL in place of the bare document id", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = mcpInput(
      environment,
      WorkspaceToolName.manage_document_comment,
      {
        action: "reply",
        document_id: FixtureDocUrl,
        comment_id: "commentc1"
      }
    )

    expect(await handleMcpWriteTool(input, environment.context)).not.toBeNull()
  })

  it("still allows a comment on the Doc after approval", async () => {
    await environment.store.save(
      createActiveReviewState(environment, { status: ReviewStatus.approved })
    )

    const input = mcpInput(
      environment,
      WorkspaceToolName.manage_document_comment,
      {
        action: "reply",
        document_id: FixtureDocId,
        comment_id: "commentlog1"
      }
    )

    expect(await handleMcpWriteTool(input, environment.context)).not.toBeNull()
  })

  it("allows a file_path sync that names the review's own plan file", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = mcpInput(environment, WorkspaceToolName.update_drive_file, {
      file_id: FixtureDocId,
      file_path: environment.planFile,
      source_format: "md",
      mode: "replace"
    })

    expect(await handleMcpWriteTool(input, environment.context)).not.toBeNull()
  })

  it("stays silent outside plan mode", async () => {
    await environment.store.save(createActiveReviewState(environment))

    for (const permissionMode of ["default", "acceptEdits", null]) {
      const input = asPreToolUse(
        createHookInput(
          environment,
          "pre-tool-use-mcp-update-drive-file.json",
          { permission_mode: permissionMode }
        )
      )

      // Outside plan mode the engine does not refuse an MCP write on its own,
      // so there is nothing for this gate to relieve and granting would only
      // widen what an unattended session can write.
      expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
    }
  })

  it("stays silent for the same write on another connected server", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-mcp-update-drive-file.json", {
        tool_name: `${ForeignServerPrefix}${WorkspaceToolName.update_drive_file}`
      })
    )

    expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
  })

  it("stays silent for the two setup writes, which the user is asked about", async () => {
    const setup = createActiveReviewState(environment, {
      status: ReviewStatus.setup,
      doc: null
    })

    await environment.store.save(setup)

    const folderInput = mcpInput(
        environment,
        WorkspaceToolName.create_drive_folder,
        { folder_name: "plans", parent_folder_id: "root" }
      ),
      importInput = mcpInput(
        environment,
        WorkspaceToolName.import_to_google_doc,
        {
          file_name: "FixturePlan",
          content: "# Fixture plan\n",
          folder_id: "1FixtureFolderIdAbCdEfGhIjKlMnOpQrStUv"
        }
      )

    expect(
      await handleMcpWriteTool(folderInput, environment.context)
    ).toBeNull()
    expect(
      await handleMcpWriteTool(importInput, environment.context)
    ).toBeNull()
  })

  it("stays silent for a write while the review is still in setup", async () => {
    await environment.store.save(
      createActiveReviewState(environment, { status: ReviewStatus.setup })
    )

    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-mcp-update-drive-file.json")
    )

    expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
  })

  it("stays silent for a cancelled review", async () => {
    await environment.store.save(
      createActiveReviewState(environment, { status: ReviewStatus.cancelled })
    )

    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-mcp-update-drive-file.json")
    )

    expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
  })

  it("stays silent for a comment call that names the Doc only in the wrong parameter", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = mcpInput(
      environment,
      WorkspaceToolName.manage_document_comment,
      {
        action: "reply",
        document_id: OtherDocumentId,
        file_id: FixtureDocId,
        comment_id: "commentc1"
      }
    )

    expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
  })

  it("stays silent for a file_path naming any other local file", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const filePaths = [
      path.join(environment.workspacePath, "other-plan.md"),
      path.join(environment.statePath, "config.json"),
      "/etc/hosts",
      ""
    ]

    for (const filePath of filePaths) {
      const input = mcpInput(environment, WorkspaceToolName.update_drive_file, {
        file_id: FixtureDocId,
        file_path: filePath,
        source_format: "md",
        mode: "replace"
      })

      expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
    }
  })

  it("stays silent for a write that hands the server content from elsewhere", async () => {
    await environment.store.save(createActiveReviewState(environment))

    for (const parameter of McpWriteToolHandler.ForeignContentParameters) {
      const input = mcpInput(environment, WorkspaceToolName.update_drive_file, {
        file_id: FixtureDocId,
        source_format: "md",
        mode: "replace",
        [parameter]: "https://evil.example/plan.md"
      })

      expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
    }
  })

  it("stays silent for a write carrying a decoy reference to another document", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = mcpInput(environment, WorkspaceToolName.update_drive_file, {
      file_id: FixtureDocId,
      document_id: OtherDocumentId,
      content: "# Fixture plan\n"
    })

    expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
  })

  it("stays silent for a write aimed at another document", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const input = mcpInput(environment, WorkspaceToolName.update_drive_file, {
      file_id: "some-other-document",
      content: "# Fixture plan\n"
    })

    expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
  })

  it("stays silent for a read-only tool and for a tool that is not this server's", async () => {
    await environment.store.save(createActiveReviewState(environment))

    const readOnlyInput = mcpInput(
        environment,
        WorkspaceToolName.list_document_comments,
        { document_id: FixtureDocId }
      ),
      foreignInput = asPreToolUse(
        createHookInput(
          environment,
          "pre-tool-use-mcp-update-drive-file.json",
          { tool_name: "mcp__other-server__write_something" }
        )
      )

    expect(
      await handleMcpWriteTool(readOnlyInput, environment.context)
    ).toBeNull()
    expect(
      await handleMcpWriteTool(foreignInput, environment.context)
    ).toBeNull()
  })

  it("stays silent when the plan has no review", async () => {
    const input = asPreToolUse(
      createHookInput(environment, "pre-tool-use-mcp-update-drive-file.json")
    )

    expect(await handleMcpWriteTool(input, environment.context)).toBeNull()
  })
})
