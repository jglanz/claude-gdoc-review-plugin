import {
  CliSubcommand,
  GatedCliSubcommand,
  HookCommandName,
  ReviewStatus
} from "claude-gdoc-review-plugin"

import type { BundleTestEnvironment } from "../support/processTestSupport.js"
import {
  createBundleTestEnvironment,
  destroyBundleTestEnvironment,
  LauncherFile,
  ProcessDocId,
  ProcessDocUrl,
  ProcessPlanName,
  runBundle,
  runBundleSetup
} from "../support/processTestSupport.js"

describe("CLI process", () => {
  let environment: BundleTestEnvironment = null

  beforeEach(async () => {
    environment = await createBundleTestEnvironment()
  })

  afterEach(async () => {
    await destroyBundleTestEnvironment(environment)
  })

  it("lists every command in --help", async () => {
    const result = await runBundle(environment, ["--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    ;[
      ...Object.values(CliSubcommand),
      ...Object.values(GatedCliSubcommand),
      HookCommandName.hook
    ].forEach(name => {
      expect(result.stdout).toContain(`gdoc-review ${name}`)
    })
  })

  it("fails with a message on an unknown command", async () => {
    const result = await runBundle(environment, ["bogus"])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("bogus")
  })

  it("creates, registers and reports a review", async () => {
    const registered = await runBundleSetup(environment)

    expect(registered.exitCode).toBe(0)
    expect(JSON.parse(registered.stdout).doc.id).toBe(ProcessDocId)

    const reported = await runBundle(environment, [
      "status",
      "--plan",
      environment.planFile,
      "--json"
    ])

    expect(reported.exitCode).toBe(0)

    const state = JSON.parse(reported.stdout)
    expect(state.status).toBe(ReviewStatus.active)
    expect(state.doc.url).toBe(ProcessDocUrl)
    expect((await environment.store.load(environment.planSlug)).status).toBe(
      ReviewStatus.active
    )
  })

  it("writes the state under CLAUDE_CONFIG_DIR", async () => {
    await runBundleSetup(environment)

    const result = await runBundle(environment, ["status"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(ProcessPlanName)
  })

  it("runs the same commands through the bin launcher", async () => {
    await runBundleSetup(environment)

    const result = await runBundle(environment, ["status"], {
      scriptFile: LauncherFile
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(ProcessPlanName)
    expect(result.stderr).toBe("")
  })

  it("reports a failing command on stderr with a non-zero exit code", async () => {
    const result = await runBundle(environment, [
      "status",
      "--plan",
      environment.planFile
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("No review state for")
  })
})
