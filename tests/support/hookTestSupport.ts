import { readFileSync } from "node:fs"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  ApproveAutoMode,
  createHookContext,
  createInitialReviewState,
  DriveKind,
  GDocReview,
  HookContext,
  HookInput,
  LogLevel,
  parseHookInput,
  PlanFileLocator,
  PluginConfig,
  ReviewState,
  ReviewStateStore,
  ReviewStatus,
  ReviewTarget,
  sha256OfText,
  SyncMode
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "./testEnvironment.js"

/** Doc id every hook fixture targets. */
export const FixtureDocId = "1FixtureDocIdAbCdEfGhIjKlMnOpQrStUvWxYz01"

/** Doc URL every hook fixture quotes. */
export const FixtureDocUrl =
  "https://docs.google.com/document/d/1FixtureDocIdAbCdEfGhIjKlMnOpQrStUvWxYz01/edit"

/** Drive folder id the fixture review's Doc lives in. */
export const FixtureFolderId = "1FixtureFolderIdAbCdEfGhIjKlMnOpQrStUv"

/** MCP server instance every hook fixture's tool name names. */
export const FixtureServerName = "gworkspace-personal"

/**
 * Revision the `AskUserQuestion` fixtures state as synced. A review must be on
 * exactly this revision for the decision hook to accept those payloads: the
 * hook matches the question body against the Doc link and revision of the
 * review it is capturing for.
 */
export const FixtureMenuRevision = 1

/** Doc title the import fixture creates. */
export const FixtureDocTitle = "FixturePlan"

/** Basename of the plan file of every hook test; the review key derives from it. */
export const FixturePlanName = "fixture-plan"

/** Bundle path the Bash allow-list fixture invokes. */
export const FixtureBundleFile =
  "/plugins/claude-gdoc-review-plugin/dist/gdoc-review.cjs"

/** Launcher path accepted next to {@link FixtureBundleFile}. */
export const FixtureLauncherFile =
  "/plugins/claude-gdoc-review-plugin/bin/gdoc-review"

/** Timestamp the injected clock returns, so recorded times are assertable. */
export const FixtureNow = new Date("2026-09-16T14:02:00.000Z")

/** A temporary plugin installation: state directory, plan file and transcript. */
export interface HookTestEnvironment {
  /** Temporary state directory backing the store. */
  statePath: string

  /** Temporary directory holding the plan file and the transcript. */
  workspacePath: string

  /** Absolute path of the plan markdown file under review. */
  planFile: string

  /** Review key {@link HookTestEnvironment.planFile} resolves to. */
  planSlug: string

  /** Absolute path of the session transcript naming {@link HookTestEnvironment.planFile}. */
  transcriptPath: string

  /** Session id the payloads carry. */
  sessionId: string

  /** Store the context reads and writes. */
  store: ReviewStateStore

  /** Context the handlers run against. */
  context: HookContext
}

/** What a test may change about the environment it creates. */
export interface HookTestOptions {
  /** Configuration override; defaults to the plugin defaults. */
  config?: PluginConfig

  /** Launcher paths the Bash gate accepts; defaults to the fixture paths. */
  cliScriptFiles?: string[]
}

/**
 * Builds the plugin configuration a hook test runs with.
 *
 * @param approveAutoMode Mode option 1 of the menu resolves to.
 * @returns A fully resolved configuration.
 */
export function createTestPluginConfig(
  approveAutoMode: ApproveAutoMode = ApproveAutoMode.acceptEdits
): PluginConfig {
  return {
    approveAutoMode,
    syncMode: SyncMode.content,
    replyPrefix: GDocReview.ReplyPrefix,
    logLevel: LogLevel.info
  }
}

/**
 * Creates a temporary state directory, plan file and transcript, and the hook
 * context pointing at them.
 *
 * @param options Configuration and allow-listed launcher overrides.
 * @returns The ready environment.
 */
export async function createHookTestEnvironment(
  options: HookTestOptions = {}
): Promise<HookTestEnvironment> {
  const {
      config = createTestPluginConfig(),
      cliScriptFiles = [FixtureBundleFile, FixtureLauncherFile]
    } = options,
    statePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("hook-state-")
    ),
    workspacePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("hook-work-")
    ),
    planFile = path.join(workspacePath, `${FixturePlanName}.md`),
    planSlug = PlanFileLocator.planSlug(planFile),
    transcriptPath = path.join(workspacePath, "transcript.jsonl"),
    sessionId = "session-under-test",
    store = await ReviewStateStore.create({ stateDirectory: statePath }),
    context = await createHookContext({
      store,
      config,
      cliScriptFiles,
      pluginRoot: path.join(__dirname, "..", ".."),
      now: () => FixtureNow
    })

  await writeFile(
    transcriptPath,
    [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "plan it" }
      }),
      JSON.stringify({
        type: "attachment",
        attachment: {
          type: "plan_mode",
          isSubAgent: false,
          planFilePath: planFile
        }
      })
    ].join("\n"),
    "utf8"
  )

  return {
    statePath,
    workspacePath,
    planFile,
    planSlug,
    transcriptPath,
    sessionId,
    store,
    context
  }
}

/**
 * Removes both temporary directories.
 *
 * @param environment The environment to discard.
 */
export async function destroyHookTestEnvironment(
  environment: HookTestEnvironment
): Promise<void> {
  if (environment == null) {
    return
  }
  await rm(environment.statePath, { recursive: true, force: true })
  await rm(environment.workspacePath, { recursive: true, force: true })
}

/**
 * Destroys every environment a test created beside the one its `beforeEach`
 * built, and empties the list.
 *
 * A test that needs a second environment — another configuration, another
 * plugin root — creates it inline, and an assertion failing before the inline
 * teardown would otherwise leak two directories per run. The caller collects
 * them in an array and calls this from `afterEach`, so the cleanup happens
 * whatever the test did.
 *
 * @param environments The collected environments; emptied in place.
 */
export async function destroyHookTestEnvironments(
  environments: HookTestEnvironment[]
): Promise<void> {
  const collected = environments.splice(0, environments.length)
  for (const environment of collected) {
    await destroyHookTestEnvironment(environment)
  }
}

/**
 * Writes the plan file.
 *
 * @param environment The environment owning the plan file.
 * @param text Plan markdown to write.
 * @returns The digest of the written text.
 */
export async function writePlanText(
  environment: HookTestEnvironment,
  text: string
): Promise<string> {
  await writeFile(environment.planFile, text, "utf8")
  return sha256OfText(text)
}

/**
 * Builds a review in the `active` status with its Doc registered.
 *
 * @param environment The environment owning the plan file.
 * @param overrides Fields replacing the defaults, e.g. `lastSync` or `decision`.
 * @returns The state, ready to be saved.
 */
export function createActiveReviewState(
  environment: HookTestEnvironment,
  overrides: Partial<ReviewState> = {}
): ReviewState {
  const target: ReviewTarget = {
      kind: DriveKind.personal,
      driveName: null,
      driveId: null,
      path: "code/claude/wip/FixturePlan",
      folderId: FixtureFolderId
    },
    initial = createInitialReviewState({
      planFile: environment.planFile,
      target
    })

  return {
    ...initial,
    status: ReviewStatus.active,
    doc: {
      id: FixtureDocId,
      url: FixtureDocUrl,
      title: FixtureDocTitle,
      serverName: FixtureServerName
    },
    ...overrides
  }
}

/**
 * Seeds the sessions cache the way a transcript scan would have, so a test can
 * exercise the fallback without running one.
 *
 * @param environment The environment owning the session and the transcript.
 * @param planFile Plan file to cache; defaults to the environment's own.
 */
export async function rememberSessionPlanFile(
  environment: HookTestEnvironment,
  planFile: string = environment.planFile
): Promise<void> {
  const stats = await stat(environment.transcriptPath)

  await environment.store.writeSessionPlanRecord(environment.sessionId, {
    planFile,
    transcriptMtimeMs: stats.mtimeMs,
    transcriptSize: stats.size
  })
}

/**
 * Reads a hook payload fixture as raw JSON.
 *
 * @param name File name under `tests/fixtures/hooks/`.
 * @returns The parsed JSON, unvalidated.
 */
export function readHookFixture(name: string): Record<string, unknown> {
  const file = path.join(__dirname, "..", "fixtures", "hooks", name)
  return JSON.parse(readFileSync(file, "utf8"))
}

/**
 * Reads a hook payload fixture and binds it to a test environment: the
 * session, transcript and working directory become the temporary ones.
 *
 * @param environment The environment the payload belongs to.
 * @param name File name under `tests/fixtures/hooks/`.
 * @param overrides Fields replacing the fixture's own, merged at the top level.
 * @returns The validated payload.
 */
export function createHookInput(
  environment: HookTestEnvironment,
  name: string,
  overrides: Record<string, unknown> = {}
): HookInput {
  return parseHookInput({
    ...readHookFixture(name),
    session_id: environment.sessionId,
    transcript_path: environment.transcriptPath,
    ...overrides
  })
}
