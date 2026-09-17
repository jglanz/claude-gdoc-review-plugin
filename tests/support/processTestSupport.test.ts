import { writeFile } from "node:fs/promises"
import path from "node:path"

import type { BundleTestEnvironment } from "./processTestSupport.js"
import {
  BundleProcess,
  createBundleTestEnvironment,
  destroyBundleTestEnvironment,
  reapBundleProcesses,
  runBundle
} from "./processTestSupport.js"

/** A child that never exits on its own, so the harness's bound is what ends it. */
const WedgedScriptText = "setInterval(() => {}, 1_000)\n"

/** File name the wedged script is written under, inside the workspace. */
const WedgedScriptName = "wedged.js"

/** A child that is gone before the harness has finished writing its stdin. */
const ExitingScriptText = "process.exit(0)\n"

/** File name the exiting script is written under, inside the workspace. */
const ExitingScriptName = "exits-immediately.js"

/** Long enough for `node` to start, short enough to keep the test fast. */
const ShortTimeoutMs = 3_000

/** Headroom over {@link ShortTimeoutMs} a bounded wait must still fit inside. */
const BoundedWaitFactor = 4

/**
 * Bigger than a pipe buffer, so the write cannot possibly complete before a
 * child that exits at once is gone — which is what makes the broken pipe the
 * harness has to absorb certain rather than occasional.
 */
const UnwritablePayloadBytes = 1_048_576

describe("spawned-process harness", () => {
  let environment: BundleTestEnvironment = null,
    wedgedScriptFile: string = null,
    exitingScriptFile: string = null

  beforeAll(async () => {
    environment = await createBundleTestEnvironment()
    wedgedScriptFile = path.join(environment.workspacePath, WedgedScriptName)
    exitingScriptFile = path.join(environment.workspacePath, ExitingScriptName)
    await writeFile(wedgedScriptFile, WedgedScriptText, "utf8")
    await writeFile(exitingScriptFile, ExitingScriptText, "utf8")
  })

  afterAll(async () => {
    await destroyBundleTestEnvironment(environment)
  })

  it("resolves for a child that exits before its stdin was written", async () => {
    const result = await runBundle(environment, [], {
      scriptFile: exitingScriptFile,
      stdin: "x".repeat(UnwritablePayloadBytes)
    })

    expect(result.exitCode).toBe(0)
  })

  it("kills a child that never exits and names the invocation", async () => {
    const startedAt = Date.now(),
      run = runBundle(environment, [], {
        scriptFile: wedgedScriptFile,
        timeoutMs: ShortTimeoutMs
      })

    await expect(run).rejects.toThrow(BundleProcess.TimeoutMessagePrefix)
    await expect(run).rejects.toThrow(WedgedScriptName)
    expect(Date.now() - startedAt).toBeLessThan(
      ShortTimeoutMs * BoundedWaitFactor
    )
  })

  it("reaps nothing once every invocation has settled", async () => {
    await runBundle(environment, [], { scriptFile: exitingScriptFile })

    expect(reapBundleProcesses).not.toThrow()
  })
})
