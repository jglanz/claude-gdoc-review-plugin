import Assert from "node:assert"

import type { CommandModule, Options } from "yargs"

import { resolvePluginConfig } from "../../config/index.js"
import { PlanFileLocator } from "../../plan/index.js"
import type { ReviewTarget } from "../../state/index.js"
import {
  createInitialReviewState,
  DriveKind,
  ReviewStateText
} from "../../state/index.js"
import { CliSubcommand, isNonEmptyString } from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import { createCliStore, resolveCliStateDirectory } from "../CliState.js"
import {
  PlanOptionDefinition,
  printReviewState,
  resolvePlanFile
} from "../commandSupport.js"

/** Arguments of the `init` command. */
export interface InitCommandArguments extends CliState.Arguments {
  /** Plan markdown file the review is keyed by. */
  plan: string

  /** Whether the Doc lives in My Drive or in a named Shared Drive. */
  kind: DriveKind

  /** Shared Drive name; required for, and only meaningful with, `--kind shared`. */
  "drive-name"?: string

  /** Drive folder path whose last segment is the Doc title. */
  path: string

  /** Replace an existing review for the same plan instead of refusing. */
  force?: boolean
}

/** Constants and message builders of the `init` command. */
export namespace InitCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Create the review state for a plan (status: setup)"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: PlanOptionDefinition,
    kind: {
      type: "string",
      demandOption: true,
      choices: Object.values(DriveKind),
      describe: "Where the Doc lives: the user's My Drive or a Shared Drive"
    },
    "drive-name": {
      type: "string",
      describe: "Name of the Shared Drive; required with --kind shared"
    },
    path: {
      type: "string",
      demandOption: true,
      describe:
        'Drive folder path whose last segment is the Doc title, e.g. "design/plans/MyPlan"'
    },
    force: {
      type: "boolean",
      default: false,
      describe: "Replace an existing review for the same plan"
    }
  }

  /** Message of the assertion guarding a missing `--path`. */
  export const MissingPathMessage =
    "--path requires the Drive folder path of the Doc"

  /** Message of the assertion guarding a Shared Drive without a name. */
  export const MissingDriveNameMessage =
    "--drive-name is required when --kind is shared"

  /**
   * States that a value carries something the review will not record.
   *
   * @param option Option the value was given for.
   * @param value The value as the caller typed it.
   * @returns The assertion message.
   */
  export function newUnprintableValueMessage(
    option: string,
    value: string
  ): string {
    return `${option} must be printable text of at most the recorded length: ${value}`
  }

  /**
   * States that a review already exists for the plan.
   *
   * @param planSlug Review key the plan file resolves to.
   * @returns The assertion message.
   */
  export function newExistingReviewMessage(planSlug: string): string {
    return `A review already exists for ${planSlug} — pass --force to replace it`
  }

  /**
   * Reports whether a value is printable text the review may record verbatim.
   *
   * @param value Candidate value.
   * @param maxLength Longest value the schema accepts.
   * @returns `true` when the value is unchanged by the sanitiser.
   */
  export function isRecordableText(value: string, maxLength: number): boolean {
    return (
      isNonEmptyString(value) &&
      ReviewStateText.sanitizeText(value, maxLength) === value
    )
  }
}

/**
 * Builds the `init` command: the first half of `/gdoc-review` setup.
 *
 * It writes the review document in the `setup` status, with the Drive target
 * the arguments describe and no Doc yet — `register` fills the Doc in, together
 * with the folder and Shared Drive ids, once the skill has found or created the
 * Doc. An existing review is refused unless `--force`
 * is given, so re-running `/gdoc-review` never silently discards a Doc id.
 *
 * The sync mode is seeded from the resolved plugin configuration of the state
 * directory this invocation works against, so a `syncMode` set in its
 * `config.json` (or in `GDOC_REVIEW_SYNC_MODE`) reaches the review without the
 * skill repeating it; `register --sync-mode` still wins.
 *
 * @returns The yargs command module.
 */
export function createInitCommand(): CommandModule<
  CliState.Arguments,
  InitCommandArguments
> {
  return {
    command: CliSubcommand.init,
    describe: InitCommand.Description,
    builder: InitCommand.OptionDefinitions,
    handler: async argv => {
      const planFile = resolvePlanFile(argv.plan),
        {
          kind,
          "drive-name": driveName = null,
          path: targetPath,
          force = false
        } = argv

      Assert.ok(isNonEmptyString(targetPath), InitCommand.MissingPathMessage)
      Assert.ok(
        kind !== DriveKind.shared || isNonEmptyString(driveName),
        InitCommand.MissingDriveNameMessage
      )
      // Both values are printed back by `status` and carried in hook messages,
      // so they are refused here rather than quietly truncated: a path the user
      // did not type is a Doc created somewhere they did not ask for.
      Assert.ok(
        InitCommand.isRecordableText(targetPath, ReviewStateText.MaxPathLength),
        InitCommand.newUnprintableValueMessage("--path", targetPath)
      )
      Assert.ok(
        driveName == null ||
          InitCommand.isRecordableText(
            driveName,
            ReviewStateText.MaxDriveNameLength
          ),
        InitCommand.newUnprintableValueMessage("--drive-name", driveName)
      )

      const store = await createCliStore(),
        { syncMode } = await resolvePluginConfig({
          stateDirectory: resolveCliStateDirectory()
        }),
        planSlug = PlanFileLocator.planSlug(planFile),
        existing = await store.load(planSlug)

      Assert.ok(
        existing == null || force,
        InitCommand.newExistingReviewMessage(planSlug)
      )

      const target: ReviewTarget = {
          kind,
          driveName,
          driveId: null,
          path: targetPath,
          folderId: null
        },
        state = createInitialReviewState({ planFile, target, syncMode })

      await store.save(state)
      printReviewState(state)
    }
  }
}
