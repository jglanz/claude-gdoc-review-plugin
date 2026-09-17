import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"

import {
  ApproveAutoMode,
  createHookContext,
  GDocReview,
  HookContext,
  PluginConfig,
  ReviewStateStore
} from "claude-gdoc-review-plugin"

import { createTestPluginConfig } from "../support/hookTestSupport.js"
import { TestEnvironment } from "../support/testEnvironment.js"

const PluginRoot = path.join(__dirname, "..", "..")

describe("HookContext", () => {
  const originalEnvironment = { ...process.env }

  let statePath: string = null

  beforeEach(async () => {
    statePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("context-")
    )
    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] = statePath
  })

  afterEach(async () => {
    process.env = { ...originalEnvironment }
    await rm(statePath, { recursive: true, force: true })
  })

  describe("createCliScriptFiles", () => {
    it("names the committed bundle and the launcher", () => {
      expect(HookContext.createCliScriptFiles("/plugins/gdoc")).toEqual([
        path.join("/plugins/gdoc", HookContext.BundleSubpath),
        path.join("/plugins/gdoc", HookContext.LauncherSubpath)
      ])
    })
  })

  describe("systemClock", () => {
    it("reads the current time", () => {
      expect(HookContext.systemClock().getTime()).toBeLessThanOrEqual(
        Date.now()
      )
    })
  })

  describe("createHookContext", () => {
    it("resolves every dependency from the state directory and plugin root", async () => {
      process.env[GDocReview.PluginRootEnvironmentKey] = PluginRoot

      const context = await createHookContext({ stateDirectory: statePath })

      expect(context.store).toBeInstanceOf(ReviewStateStore)
      expect(context.store.config.stateDirectory).toBe(statePath)
      expect(context.config.approveAutoMode).toBe(ApproveAutoMode.acceptEdits)
      expect(context.locator.store).toBe(context.store)
      expect(context.renderer.pluginRoot).toBe(PluginRoot)
      expect(context.cliScriptFiles).toEqual(
        HookContext.createCliScriptFiles(PluginRoot)
      )
      expect(context.now()).toBeInstanceOf(Date)
      expect(typeof context.log.debug).toBe("function")
    })

    it("uses every injected dependency instead of resolving it", async () => {
      const store = await ReviewStateStore.create({
          stateDirectory: statePath
        }),
        config = createTestPluginConfig(ApproveAutoMode.auto),
        now = () => new Date("2026-09-16T00:00:00.000Z"),
        context = await createHookContext({
          store,
          config,
          now,
          cliScriptFiles: ["/only/this/one"],
          pluginRoot: PluginRoot
        })

      expect(context.store).toBe(store)
      expect(context.config).toBe(config)
      expect(context.now).toBe(now)
      expect(context.cliScriptFiles).toEqual(["/only/this/one"])
    })
  })
})
