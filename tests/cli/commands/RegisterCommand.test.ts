import {
  createRegisterCommand,
  RegisterCommand,
  ReviewStatus,
  SyncMode
} from "claude-gdoc-review-plugin"

import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  CliDocId,
  CliDocTitle,
  CliDocUrl,
  CliFolderId,
  CliServerName,
  CliTargetPath,
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli
} from "../../support/cliTestSupport.js"

/** Shared Drive id shaped the way a `list_drive_items` response returns one. */
const SharedDriveId = "0ASharedDriveIdAbCdEfGhIjKl"

async function runInit(environment: CliTestEnvironment): Promise<void> {
  await runCli(environment, [
    "init",
    "--plan",
    environment.planFile,
    "--kind",
    "shared",
    "--drive-name",
    "Engineering",
    "--path",
    CliTargetPath
  ])
}

describe("createRegisterCommand", () => {
  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
  })

  afterEach(async () => {
    await destroyCliTestEnvironment(environment)
  })

  it("is registered under the register subcommand name", () => {
    expect(createRegisterCommand().command).toBe("register")
  })

  it("titles the Doc after the last segment of the target path", () => {
    expect(RegisterCommand.titleOf("design/plans/MySpecialPlan")).toBe(
      "MySpecialPlan"
    )
    expect(RegisterCommand.titleOf("MySpecialPlan")).toBe("MySpecialPlan")
    expect(RegisterCommand.titleOf("design/plans/Trailing/")).toBe("Trailing")
  })

  it("activates the review with the Doc and the drive ids", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName,
      "--drive-id",
      SharedDriveId
    ])

    expect(result.exitCode).toBe(0)

    const state = await environment.store.load(environment.planSlug)
    expect(state.status).toBe(ReviewStatus.active)
    expect(state.doc).toEqual({
      id: CliDocId,
      url: CliDocUrl,
      title: CliDocTitle,
      serverName: CliServerName
    })
    expect(state.target.folderId).toBe(CliFolderId)
    expect(state.target.driveId).toBe(SharedDriveId)
    expect(state.syncMode).toBe(SyncMode.content)
    expect(JSON.parse(result.stdout).status).toBe(ReviewStatus.active)
  })

  it("keeps a drive id it already recorded when the caller omits it", async () => {
    await runInit(environment)

    const initial = await environment.store.load(environment.planSlug)

    await environment.store.save({
      ...initial,
      target: { ...initial.target, driveId: SharedDriveId }
    })

    const registered = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName
    ])

    expect(registered.exitCode).toBe(0)
    // Completing the target must not blank out a Shared Drive already on it
    // just because the caller did not repeat the flag.
    expect(
      (await environment.store.load(environment.planSlug)).target.driveId
    ).toBe(SharedDriveId)
  })

  it("applies an explicit --sync-mode", async () => {
    await runInit(environment)

    await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName,
      "--sync-mode",
      SyncMode.file_path
    ])

    const state = await environment.store.load(environment.planSlug)
    expect(state.syncMode).toBe(SyncMode.file_path)
    expect(state.target.driveId).toBeNull()
  })

  it("fails when no review exists for the plan", async () => {
    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("No review state for")
  })

  it("normalizes a document link given as the doc id", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocUrl,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).doc.id).toBe(CliDocId)
    expect((await environment.store.load(environment.planSlug)).doc.id).toBe(
      CliDocId
    )
  })

  it("refuses a doc id that is not a Drive file id", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      "https://evil.example/?x=https://docs.google.com/document/d/root",
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("--doc-id is not a Google Drive file id")
    expect((await environment.store.load(environment.planSlug)).status).toBe(
      ReviewStatus.setup
    )
  })

  it("refuses a doc url that is not a canonical Google Docs link", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      `https://evil.example/?next=${CliDocUrl}`,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("--doc-url is not a")
    expect((await environment.store.load(environment.planSlug)).doc).toBeNull()
  })

  it("refuses a folder id that is not shaped like a Drive id", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      "root",
      "--server",
      CliServerName
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("--folder-id is not a Google Drive id")
    expect((await environment.store.load(environment.planSlug)).status).toBe(
      ReviewStatus.setup
    )
  })

  it("accepts a Shared Drive id that is shorter than a file id", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName,
      "--drive-id",
      SharedDriveId
    ])

    expect(result.exitCode).toBe(0)
    expect(
      (await environment.store.load(environment.planSlug)).target.driveId
    ).toBe(SharedDriveId)
  })

  it("refuses a drive id that is not shaped like one", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      CliServerName,
      "--drive-id",
      "root"
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("--drive-id is not a Shared Drive id")
  })

  it("refuses a server name that is not an MCP server instance name", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId,
      "--doc-url",
      CliDocUrl,
      "--folder-id",
      CliFolderId,
      "--server",
      "mcp__gworkspace-personal__"
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("--server is not an MCP server instance")
    expect((await environment.store.load(environment.planSlug)).doc).toBeNull()
  })

  it("fails when a required option is missing", async () => {
    await runInit(environment)

    const result = await runCli(environment, [
      "register",
      "--plan",
      environment.planFile,
      "--doc-id",
      CliDocId
    ])

    expect(result.exitCode).toBe(1)
    expect((await environment.store.load(environment.planSlug)).status).toBe(
      ReviewStatus.setup
    )
  })
})
