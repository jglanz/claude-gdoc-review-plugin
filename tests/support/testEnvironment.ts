import Assert from "node:assert"
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"

/** Constants shared by the Jest setup file, the suites and the global teardown. */
export namespace TestEnvironment {
  /**
   * Prefix of the one directory a run owns. Every temporary directory the suite
   * makes lives inside it, and the teardown removes that directory and nothing
   * else — a teardown matching `$TMPDIR/gdoc-review-*` would delete the live
   * directories of a second run happening at the same time, which fails the
   * other run with a bare `ENOENT` somewhere it never wrote.
   */
  export const RunDirectoryPrefix = "gdoc-review-run-"

  /**
   * Environment variable naming the run directory. `globalSetup` creates the
   * directory and exports it before any worker is forked, so every worker, every
   * process the suite spawns — the bundle under `tests/integration/` — and the
   * `globalTeardown` all name the same directory by reading one variable.
   */
  export const RunDirectoryEnvironmentKey = "GDOC_REVIEW_TEST_RUN_DIRECTORY"

  /** Prefix of every per-worker config directory inside the run directory. */
  export const ConfigDirectoryPrefix = "jest-worker"

  /** Environment variable naming the worker Jest is running a test file in. */
  export const WorkerIdEnvironmentKey = "JEST_WORKER_ID"

  /** Worker id assumed when Jest runs in band and names none. */
  export const DefaultWorkerId = "1"

  /** Mode the run directory is created with: owner-only, like the plugin's own. */
  export const DirectoryMode = 0o700

  /** Message of the assertion that fires when the run directory was not exported. */
  export const MissingRunDirectoryMessage = `${RunDirectoryEnvironmentKey} is unset: tests/support/globalSetup.ts did not run`

  /**
   * Reads the run directory `globalSetup` created and exported.
   *
   * There is no derivation to fall back on, and deliberately so: a second way
   * of naming the directory is a second way for two runs to name each other's.
   *
   * @returns Absolute path of the run directory.
   */
  export function newRunDirectoryPath(): string {
    const { [RunDirectoryEnvironmentKey]: configuredPath } = process.env

    Assert.ok(
      configuredPath != null && configuredPath !== "",
      MissingRunDirectoryMessage
    )
    return configuredPath
  }

  /**
   * Returns the run directory, making sure it exists.
   *
   * `globalSetup` already created it; the `mkdir` is what keeps a suite working
   * after a test has removed a directory inside it, and is idempotent, so every
   * worker may call it at once.
   *
   * @returns Absolute path of the run directory.
   */
  export function createRunDirectory(): string {
    const runDirectoryPath = newRunDirectoryPath()

    mkdirSync(runDirectoryPath, { recursive: true, mode: DirectoryMode })
    return runDirectoryPath
  }

  /**
   * Builds the `mkdtemp` template of one temporary directory inside the run
   * directory. It is the only way a test makes one: a directory made directly
   * in `$TMPDIR` would outlive the run, because the teardown removes the run
   * directory rather than everything that looks like it belongs to the suite.
   *
   * @param prefix Name the random suffix is appended to; end it with a dash.
   * @returns The template path `mkdtemp` appends its randomness to.
   */
  export function newTemporaryDirectoryTemplate(prefix: string): string {
    return path.join(createRunDirectory(), prefix)
  }

  /**
   * Builds the `mkdtemp` template of one worker's config directory.
   *
   * @param workerId Value of {@link WorkerIdEnvironmentKey}.
   * @returns The template path `mkdtemp` appends its randomness to.
   */
  export function newConfigDirectoryTemplate(workerId: string): string {
    return newTemporaryDirectoryTemplate(`${ConfigDirectoryPrefix}${workerId}-`)
  }
}

/**
 * Removes the one directory this run created everything inside, after the whole
 * run. Jest's `globalTeardown` runs in the Jest process, which is the process
 * `globalSetup` exported {@link TestEnvironment.RunDirectoryEnvironmentKey} in,
 * so the two name the same directory by construction — and nothing else is
 * touched, because a teardown that swept `$TMPDIR/gdoc-review-*` would delete a
 * concurrent run's live state.
 *
 * The default export is Jest's own contract for a `globalTeardown` module, the
 * same framework shape `jest.config.ts` uses. This module carries no relative
 * import on purpose: Jest loads a global hook outside the test module registry,
 * where `moduleNameMapper` — and therefore the `.js` suffix rewrite — does not
 * apply.
 */
export default function removeRunDirectory(): void {
  rmSync(TestEnvironment.newRunDirectoryPath(), {
    recursive: true,
    force: true
  })
}
