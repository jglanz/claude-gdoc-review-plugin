import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  PlanFileLocator,
  resetCliState,
  ReviewStateStore,
  sha256OfText
} from "claude-gdoc-review-plugin"
import { main } from "claude-gdoc-review-plugin/cli/index"

import { TestEnvironment } from "./testEnvironment.js"

/** Basename of the plan file of every CLI test; the review key derives from it. */
export const CliPlanName = "cli-plan"

/** Doc id the CLI tests register. */
export const CliDocId = "1CliDocIdAbCdEfGhIjKlMnOpQrStUvWxYz012345"

/** Doc URL the CLI tests register. */
export const CliDocUrl =
  "https://docs.google.com/document/d/1CliDocIdAbCdEfGhIjKlMnOpQrStUvWxYz012345/edit"

/** Drive folder path the CLI tests use; its last segment is the Doc title. */
export const CliTargetPath = "design/plans/CliPlan"

/** Doc title {@link CliTargetPath} resolves to. */
export const CliDocTitle = "CliPlan"

/** Drive folder id the CLI tests register the Doc under. */
export const CliFolderId = "1CliFolderIdAbCdEfGhIjKlMnOpQrStUvWx"

/** MCP server instance the CLI tests register the Doc against. */
export const CliServerName = "gworkspace-personal"

/** A temporary CLI installation: state directory, workspace and plan file. */
export interface CliTestEnvironment {
  /** Temporary state directory passed as `--state-dir`. */
  statePath: string

  /** Temporary directory holding the plan file. */
  workspacePath: string

  /** Absolute path of the plan markdown file under review. */
  planFile: string

  /** Review key {@link CliTestEnvironment.planFile} resolves to. */
  planSlug: string

  /** Store the assertions read. */
  store: ReviewStateStore
}

/** What one `main()` invocation produced. */
export interface CliRunResult {
  /** Exit code `main()` returned. */
  exitCode: number

  /** Everything the invocation wrote to stdout. */
  stdout: string

  /** Everything the invocation wrote to stderr. */
  stderr: string
}

/**
 * Creates a temporary state directory, workspace and plan file.
 *
 * @returns The ready environment.
 */
export async function createCliTestEnvironment(): Promise<CliTestEnvironment> {
  const statePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("cli-state-")
    ),
    workspacePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("cli-work-")
    ),
    planFile = path.join(workspacePath, `${CliPlanName}.md`),
    planSlug = PlanFileLocator.planSlug(planFile),
    store = await ReviewStateStore.create({ stateDirectory: statePath })

  await writeFile(planFile, "# CLI plan\n\nFirst revision.\n", "utf8")

  return { statePath, workspacePath, planFile, planSlug, store }
}

/**
 * Removes both temporary directories and resets the module-level CLI state.
 *
 * @param environment The environment to discard.
 */
export async function destroyCliTestEnvironment(
  environment: CliTestEnvironment
): Promise<void> {
  resetCliState()
  await rm(environment.statePath, { recursive: true, force: true })
  await rm(environment.workspacePath, { recursive: true, force: true })
}

/**
 * Rewrites the plan file.
 *
 * @param environment The environment owning the plan file.
 * @param text Plan markdown to write.
 * @returns The digest of the written text.
 */
export async function writeCliPlanText(
  environment: CliTestEnvironment,
  text: string
): Promise<string> {
  await writeFile(environment.planFile, text, "utf8")
  return sha256OfText(text)
}

/**
 * Runs one CLI invocation against the environment's state directory, capturing
 * both streams so nothing a command prints reaches the test reporter.
 *
 * @param environment The environment the command runs against.
 * @param args Command-line arguments, without `--state-dir`.
 * @returns The exit code and the captured output.
 */
export async function runCli(
  environment: CliTestEnvironment,
  args: string[]
): Promise<CliRunResult> {
  const chunks: string[] = [],
    errorChunks: string[] = [],
    outSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        chunks.push(String(chunk))
        return true
      }),
    errorSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        errorChunks.push(String(chunk))
        return true
      })

  try {
    const exitCode = await main([...args, "--state-dir", environment.statePath])
    return {
      exitCode,
      stdout: chunks.join(""),
      stderr: errorChunks.join("")
    }
  } finally {
    outSpy.mockRestore()
    errorSpy.mockRestore()
    resetCliState()
  }
}

/**
 * Runs the CLI commands that take a review from nothing to `active`.
 *
 * @param environment The environment the review belongs to.
 * @returns The result of the `register` invocation.
 */
export async function runCliSetup(
  environment: CliTestEnvironment
): Promise<CliRunResult> {
  await runCli(environment, [
    "init",
    "--plan",
    environment.planFile,
    "--kind",
    "personal",
    "--path",
    CliTargetPath
  ])

  return await runCli(environment, [
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
}
