import path from "node:path"

import {
  createInitCommand,
  DriveKind,
  InitCommand,
  PluginConfig,
  ReviewStatus,
  SyncMode,
  writeFileAtomic
} from "claude-gdoc-review-plugin"

import type { CliTestEnvironment } from "../../support/cliTestSupport.js"
import {
  CliTargetPath,
  createCliTestEnvironment,
  destroyCliTestEnvironment,
  runCli
} from "../../support/cliTestSupport.js"

describe("createInitCommand", () => {
  const originalEnvironment = { ...process.env }

  let environment: CliTestEnvironment = null

  beforeEach(async () => {
    environment = await createCliTestEnvironment()
  })

  afterEach(async () => {
    process.env = { ...originalEnvironment }
    await destroyCliTestEnvironment(environment)
  })

  it("seeds the review's sync mode from the config.json of --state-dir", async () => {
    await writeFileAtomic(
      path.join(environment.statePath, PluginConfig.ConfigFileName),
      JSON.stringify({ syncMode: SyncMode.file_path })
    )

    await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.personal,
      "--path",
      CliTargetPath
    ])

    expect((await environment.store.load(environment.planSlug)).syncMode).toBe(
      SyncMode.file_path
    )
  })

  it("refuses --drive-id, which register records instead", async () => {
    const result = await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.shared,
      "--drive-name",
      "Engineering",
      "--drive-id",
      "0ASharedDriveIdAbCdEfGhIjKl",
      "--path",
      CliTargetPath
    ])

    // The Shared Drive id is metadata `register` completes the target with;
    // `init` runs before the skill has resolved it.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("drive-id")
    await expect(
      environment.store.load(environment.planSlug)
    ).resolves.toBeNull()
  })

  it("refuses a path carrying a control character", async () => {
    const result = await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.personal,
      "--path",
      "design/\u001b[2Jplans/X"
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("--path must be printable text")
    await expect(
      environment.store.load(environment.planSlug)
    ).resolves.toBeNull()
  })

  it("seeds the review's sync mode from the resolved configuration", async () => {
    process.env[PluginConfig.SyncModeEnvironmentKey] = SyncMode.file_path

    await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.personal,
      "--path",
      CliTargetPath
    ])

    expect((await environment.store.load(environment.planSlug)).syncMode).toBe(
      SyncMode.file_path
    )
  })

  it("falls back to the default sync mode when nothing configures one", async () => {
    delete process.env[PluginConfig.SyncModeEnvironmentKey]

    await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.personal,
      "--path",
      CliTargetPath
    ])

    expect((await environment.store.load(environment.planSlug)).syncMode).toBe(
      PluginConfig.DefaultSyncMode
    )
  })

  it("is registered under the init subcommand name", () => {
    expect(createInitCommand().command).toBe("init")
    expect(createInitCommand().describe).toBe(InitCommand.Description)
  })

  it("writes a setup review carrying the drive target and prints it", async () => {
    const result = await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.personal,
      "--path",
      CliTargetPath
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")

    const printed = JSON.parse(result.stdout),
      state = await environment.store.load(environment.planSlug)

    expect(printed.status).toBe(ReviewStatus.setup)
    expect(state.status).toBe(ReviewStatus.setup)
    expect(state.planFile).toBe(environment.planFile)
    expect(state.target).toEqual({
      kind: DriveKind.personal,
      driveName: null,
      driveId: null,
      path: CliTargetPath,
      folderId: null
    })
    expect(state.doc).toBeNull()
  })

  it("records the shared drive name", async () => {
    const result = await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.shared,
      "--drive-name",
      "Engineering",
      "--path",
      CliTargetPath
    ])

    expect(result.exitCode).toBe(0)

    const state = await environment.store.load(environment.planSlug)
    expect(state.target.kind).toBe(DriveKind.shared)
    expect(state.target.driveName).toBe("Engineering")
  })

  it("resolves a relative --plan value to an absolute path", async () => {
    const relativePlanFile = path.relative(process.cwd(), environment.planFile)

    await runCli(environment, [
      "init",
      "--plan",
      relativePlanFile,
      "--kind",
      DriveKind.personal,
      "--path",
      CliTargetPath
    ])

    const state = await environment.store.load(environment.planSlug)
    expect(state.planFile).toBe(environment.planFile)
  })

  it("refuses a shared drive without a name", async () => {
    const result = await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.shared,
      "--path",
      CliTargetPath
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(InitCommand.MissingDriveNameMessage)
    expect(await environment.store.load(environment.planSlug)).toBeNull()
  })

  it("refuses to replace an existing review without --force", async () => {
    const args = [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.personal,
      "--path",
      CliTargetPath
    ]

    expect((await runCli(environment, args)).exitCode).toBe(0)

    const second = await runCli(environment, args)
    expect(second.exitCode).toBe(1)
    expect(second.stderr).toContain(
      InitCommand.newExistingReviewMessage(environment.planSlug)
    )
  })

  it("replaces an existing review with --force", async () => {
    await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.personal,
      "--path",
      CliTargetPath
    ])

    const result = await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      DriveKind.shared,
      "--drive-name",
      "Engineering",
      "--path",
      "other/path/Renamed",
      "--force"
    ])

    expect(result.exitCode).toBe(0)

    const state = await environment.store.load(environment.planSlug)
    expect(state.target.path).toBe("other/path/Renamed")
  })

  it("rejects an unknown --kind through the parser", async () => {
    const result = await runCli(environment, [
      "init",
      "--plan",
      environment.planFile,
      "--kind",
      "external",
      "--path",
      CliTargetPath
    ])

    expect(result.exitCode).toBe(1)
    expect(await environment.store.load(environment.planSlug)).toBeNull()
  })
})
