import { mkdtempSync } from "node:fs"

import { PluginConfig } from "claude-gdoc-review-plugin/config/index"

import { TestEnvironment } from "./testEnvironment.js"

const { [TestEnvironment.WorkerIdEnvironmentKey]: workerId } = process.env

// `globalSetup` created the run directory and exported it before any worker was
// forked; this file only makes the per-worker config directory inside it, and
// it does so before any test module is loaded.
process.env[PluginConfig.ConfigDirectoryEnvironmentKey] = mkdtempSync(
  TestEnvironment.newConfigDirectoryTemplate(
    workerId == null || workerId === ""
      ? TestEnvironment.DefaultWorkerId
      : workerId
  )
)
