import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  FsUtils,
  GDocReview,
  NestedError,
  PlanFileLocator,
  PluginConfig,
  ReviewStateStore
} from "claude-gdoc-review-plugin"
import { identity } from "lodash"

import { readHookFixture } from "./hookTestSupport.js"
import { TestEnvironment } from "./testEnvironment.js"

/** Repository root, which is also the plugin root a Claude Code install sees. */
export const PluginRootPath = path.resolve(__dirname, "..", "..")

/** The committed bundle every hook and CLI invocation runs. */
export const BundleFile = path.join(PluginRootPath, "dist", "gdoc-review.cjs")

/** The plain-JS launcher that requires the bundle. */
export const LauncherFile = path.join(PluginRootPath, "bin", "gdoc-review")

/** Doc id the hook fixtures target, and therefore the one the tests register. */
export const ProcessDocId = "1FixtureDocIdAbCdEfGhIjKlMnOpQrStUvWxYz01"

/** Doc URL matching {@link ProcessDocId}. */
export const ProcessDocUrl =
  "https://docs.google.com/document/d/1FixtureDocIdAbCdEfGhIjKlMnOpQrStUvWxYz01/edit"

/** Plan text whose digest matches the `content` of the sync fixtures. */
export const ProcessPlanText = "# Fixture plan\n\nCache the results in Redis.\n"

/** Basename of the plan file of the spawned-process tests; the review key derives from it. */
export const ProcessPlanName = "process-plan"

/** Session id the spawned payloads carry. */
export const ProcessSessionId = "process-session"

/** Drive folder id the spawned-process review registers its Doc under. */
export const ProcessFolderId = "1ProcFolderIdAbCdEfGhIjKlMnOpQrStUvWx"

/** MCP server instance the spawned-process review registers its Doc against. */
export const ProcessServerName = "gworkspace-personal"

/** A temporary plugin installation the spawned processes run against. */
export interface BundleTestEnvironment {
  /** Directory passed as `CLAUDE_CONFIG_DIR`. */
  configPath: string

  /** Temporary directory holding the plan file and the transcript. */
  workspacePath: string

  /** Absolute path of the plan markdown file under review. */
  planFile: string

  /** Review key {@link BundleTestEnvironment.planFile} resolves to. */
  planSlug: string

  /** Absolute path of the transcript naming {@link BundleTestEnvironment.planFile}. */
  transcriptPath: string

  /** Store reading the same state directory the spawned processes write. */
  store: ReviewStateStore
}

/** What one spawned invocation produced. */
export interface BundleRunResult {
  /** Exit code the process ended with; `null` when it was killed by a signal. */
  exitCode: number

  /** Everything the process wrote to stdout. */
  stdout: string

  /** Everything the process wrote to stderr. */
  stderr: string

  /** Wall-clock duration of the invocation, including process start-up. */
  durationMs: number
}

/** Constants of the spawned-process harness itself. */
export namespace BundleProcess {
  /**
   * How long one spawned invocation may take before the harness kills it and
   * fails the test.
   *
   * The bundle answers a hook in well under a second, so a child still running
   * after this is wedged rather than slow. Leaving it to Jest's own per-test
   * timeout instead would cost two minutes per stalled invocation, would not
   * say which invocation stalled, and — because the child is `unref`ed — would
   * leave it running for the rest of the suite, slowing every later spawn.
   */
  export const TimeoutMs = 20_000

  /**
   * Signal a child is killed with, both on timeout and when a test ends with
   * one still running. `SIGKILL` rather than `SIGTERM`: the harness only kills
   * a child it has already given up on, and that child has nothing left to
   * flush that any assertion reads.
   */
  export const KillSignal: NodeJS.Signals = "SIGKILL"

  /** Lead-in of the error a timed-out invocation is reported with. */
  export const TimeoutMessagePrefix = "Spawned bundle did not exit within"

  /** Lead-in of the error a spawn failure is reported with. */
  export const SpawnFailureMessage = "Spawning the bundle failed"

  /** Separator the reported argument list is joined with. */
  export const ArgumentSeparator = " "
}

/** What a caller may change about one spawned invocation. */
export interface BundleRunOptions {
  /** Text piped to the process's stdin; the stream is closed immediately when omitted. */
  stdin?: string

  /** Script to run; defaults to the committed bundle. */
  scriptFile?: string

  /** Environment entries replacing the ones the harness sets. */
  environmentOverrides?: NodeJS.ProcessEnv

  /**
   * How long the child may run before it is killed and the invocation fails;
   * defaults to {@link BundleProcess.TimeoutMs}. Only a test about the bound
   * itself has a reason to shorten it.
   */
  timeoutMs?: number
}

/**
 * What one spawned invocation was, as a failure reports it. It extends
 * {@link NestedError.Context} so it can be attached to the error verbatim.
 */
export interface BundleRunContext extends NestedError.Context {
  /** Command-line arguments the bundle was given. */
  args: string[]

  /** Script the invocation ran. */
  scriptFile: string

  /** Working directory the child was spawned in. */
  workspacePath: string

  /** Directory the child's `CLAUDE_CONFIG_DIR` named. */
  configPath: string
}

const liveChildren = new Set<ChildProcess>()

function writeStdinAndClose(child: ChildProcess, stdin: string): void {
  // A child that has already exited — a `--help`, a rejected command line —
  // leaves the harness writing into a closed pipe. The stream reports that as
  // an `error` event, which Node re-throws as an uncaught exception when it is
  // unhandled, and an uncaught exception inside a Jest worker breaks the run
  // somewhere other than where it happened. The invocation's real outcome is
  // the one `close` reports, so the broken pipe is absorbed here.
  child.stdin.on("error", identity)
  child.stdin.end(stdin ?? "")
}

function describeInvocation(context: BundleRunContext): string {
  const { args, scriptFile, workspacePath } = context
  return `${scriptFile} ${args.join(BundleProcess.ArgumentSeparator)} (cwd ${workspacePath})`
}

function newTimeoutError(
  context: BundleRunContext,
  timeoutMs: number,
  chunks: string[],
  errorChunks: string[]
): NestedError {
  return new NestedError(
    `${BundleProcess.TimeoutMessagePrefix} ${timeoutMs}ms: ${describeInvocation(context)}`,
    {
      context: {
        ...context,
        timeoutMs,
        stdout: chunks.join(""),
        stderr: errorChunks.join("")
      }
    }
  )
}

/**
 * Kills every child a test left running and forgets it.
 *
 * `runBundle` unrefs its children, so one that outlives its test is not reaped
 * by the worker exiting: it keeps a CPU core and its pipes for the rest of the
 * run. Every spawned-process test ends by discarding its environment, so
 * {@link destroyBundleTestEnvironment} is where the reaping belongs.
 */
export function reapBundleProcesses(): void {
  liveChildren.forEach(child => {
    child.kill(BundleProcess.KillSignal)
  })
  liveChildren.clear()
}

/**
 * Creates the temporary config directory, workspace, plan file and transcript
 * the spawned-process tests share.
 *
 * @returns The ready environment.
 */
export async function createBundleTestEnvironment(): Promise<BundleTestEnvironment> {
  const configPath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("proc-config-")
    ),
    workspacePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("proc-work-")
    ),
    planFile = path.join(workspacePath, `${ProcessPlanName}.md`),
    transcriptPath = path.join(workspacePath, "transcript.jsonl"),
    planSlug = PlanFileLocator.planSlug(planFile),
    store = await ReviewStateStore.create({
      stateDirectory: path.join(configPath, GDocReview.StateDirName)
    })

  await writeFile(planFile, ProcessPlanText, FsUtils.Encoding)
  await writeFile(
    transcriptPath,
    [
      JSON.stringify({ type: "user", message: { role: "user" } }),
      JSON.stringify({
        type: "attachment",
        attachment: {
          type: "plan_mode",
          isSubAgent: false,
          planFilePath: planFile
        }
      })
    ].join("\n"),
    FsUtils.Encoding
  )

  return {
    configPath,
    workspacePath,
    planFile,
    planSlug,
    transcriptPath,
    store
  }
}

/**
 * Reaps any child still running and removes both temporary directories.
 *
 * The reaping comes first: a surviving child writes into the state directory
 * this call is about to delete, and a spawn whose `cwd` has been removed fails
 * with a bare `ENOENT` that names neither the test nor the directory.
 *
 * @param environment The environment to discard.
 */
export async function destroyBundleTestEnvironment(
  environment: BundleTestEnvironment
): Promise<void> {
  reapBundleProcesses()
  await rm(environment.configPath, { recursive: true, force: true })
  await rm(environment.workspacePath, { recursive: true, force: true })
}

/**
 * Spawns the committed bundle exactly the way Claude Code does: a bare `node`
 * invocation with `CLAUDE_CONFIG_DIR` and `CLAUDE_PLUGIN_ROOT` set, and the
 * payload on stdin.
 *
 * The wait is bounded by {@link BundleProcess.TimeoutMs} and every failure —
 * a spawn that never started, a child that never exited — is reported as a
 * {@link NestedError} naming the arguments and whatever the child managed to
 * write. Waiting for `close` unconditionally instead turns any stall into a
 * two-minute Jest timeout that names no invocation and leaves the child alive.
 *
 * @param environment The temporary installation to run against.
 * @param args Command-line arguments.
 * @param options Stdin text, an alternative script, environment overrides and
 *   the wait bound.
 * @returns The exit code, both streams and the measured duration.
 */
export async function runBundle(
  environment: BundleTestEnvironment,
  args: string[],
  options: BundleRunOptions = {}
): Promise<BundleRunResult> {
  const {
      stdin = "",
      scriptFile = BundleFile,
      environmentOverrides = {},
      timeoutMs = BundleProcess.TimeoutMs
    } = options,
    startedAt = Date.now(),
    child = spawn(process.execPath, [scriptFile, ...args], {
      cwd: environment.workspacePath,
      env: {
        ...process.env,
        [PluginConfig.ConfigDirectoryEnvironmentKey]: environment.configPath,
        [GDocReview.PluginRootEnvironmentKey]: PluginRootPath,
        ...environmentOverrides
      },
      stdio: ["pipe", "pipe", "pipe"]
    }),
    chunks: string[] = [],
    errorChunks: string[] = []

  liveChildren.add(child)
  child.unref()
  child.stdout.setEncoding(FsUtils.Encoding)
  child.stderr.setEncoding(FsUtils.Encoding)
  child.stdout.on("data", chunk => chunks.push(String(chunk)))
  child.stderr.on("data", chunk => errorChunks.push(String(chunk)))
  writeStdinAndClose(child, stdin)

  const context: BundleRunContext = {
    args,
    scriptFile,
    workspacePath: environment.workspacePath,
    configPath: environment.configPath
  }

  try {
    return await new Promise<BundleRunResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill(BundleProcess.KillSignal)
        reject(newTimeoutError(context, timeoutMs, chunks, errorChunks))
      }, timeoutMs)

      child.on("error", cause => {
        clearTimeout(timeout)
        reject(
          new NestedError(
            `${BundleProcess.SpawnFailureMessage}: ${describeInvocation(context)}`,
            { cause, context }
          )
        )
      })
      child.on("close", exitCode => {
        clearTimeout(timeout)
        resolve({
          exitCode,
          stdout: chunks.join(""),
          stderr: errorChunks.join(""),
          durationMs: Date.now() - startedAt
        })
      })
    })
  } finally {
    liveChildren.delete(child)
  }
}

/**
 * Reads a hook payload fixture and binds it to a spawned-process environment.
 *
 * @param environment The environment the payload belongs to.
 * @param name File name under `tests/fixtures/hooks/`.
 * @param overrides Fields replacing the fixture's own, merged at the top level.
 * @returns The payload as the text to pipe to the bundle's stdin.
 */
export function createBundlePayload(
  environment: BundleTestEnvironment,
  name: string,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    ...readHookFixture(name),
    session_id: ProcessSessionId,
    transcript_path: environment.transcriptPath,
    cwd: environment.workspacePath,
    ...overrides
  })
}

/**
 * Runs the bundle's own `init` and `register` commands, so the review the hook
 * tests exercise was created the way the `/gdoc-review` skill creates it.
 *
 * @param environment The environment the review belongs to.
 * @returns The result of the `register` invocation.
 */
export async function runBundleSetup(
  environment: BundleTestEnvironment
): Promise<BundleRunResult> {
  await runBundle(environment, [
    "init",
    "--plan",
    environment.planFile,
    "--kind",
    "personal",
    "--path",
    "code/claude/wip/FixturePlan"
  ])

  return await runBundle(environment, [
    "register",
    "--plan",
    environment.planFile,
    "--doc-id",
    ProcessDocId,
    "--doc-url",
    ProcessDocUrl,
    "--folder-id",
    ProcessFolderId,
    "--server",
    ProcessServerName
  ])
}
