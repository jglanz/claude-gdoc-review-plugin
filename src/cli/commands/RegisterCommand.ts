import Assert from "node:assert"

import { last } from "lodash"
import type { CommandModule, Options } from "yargs"

import {
  extractDocumentId,
  isDocumentId,
  isDocumentUrl,
  isDriveId,
  ToolResponseParsers,
  WorkspaceToolName
} from "../../google/index.js"
import type { ReviewState } from "../../state/index.js"
import { ReviewStateText, ReviewStatus, SyncMode } from "../../state/index.js"
import { CliSubcommand, isNonEmptyString } from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import { createCliStore } from "../CliState.js"
import {
  assertReviewState,
  PlanOptionDefinition,
  printReviewState,
  resolvePlanFile
} from "../commandSupport.js"

/** Arguments of the `register` command. */
export interface RegisterCommandArguments extends CliState.Arguments {
  /** Plan markdown file the review is keyed by. */
  plan: string

  /** Google Doc file id the review syncs into. */
  "doc-id": string

  /** Link reviewers open; validated, then rebuilt from the id. */
  "doc-url": string

  /** Drive folder holding the Doc. */
  "folder-id": string

  /** Shared Drive id; absent for a personal drive. */
  "drive-id"?: string

  /** MCP server instance the Doc was found or created through. */
  server: string

  /** How the plan text reaches `update_drive_file`. */
  "sync-mode"?: SyncMode
}

/** Constants and helpers of the `register` command. */
export namespace RegisterCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Attach the Google Doc to a review and activate it (status: active)"

  /** Separator between the segments of the Drive folder path. */
  export const PathSeparator = "/"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    plan: PlanOptionDefinition,
    "doc-id": {
      type: "string",
      demandOption: true,
      describe:
        "Google Doc file id; a canonical document link is accepted and stored as its id"
    },
    "doc-url": {
      type: "string",
      demandOption: true,
      describe: "Link reviewers open"
    },
    "folder-id": {
      type: "string",
      demandOption: true,
      describe: "Drive folder holding the Doc"
    },
    "drive-id": {
      type: "string",
      describe: "Shared Drive id; omit for a personal drive"
    },
    server: {
      type: "string",
      demandOption: true,
      describe:
        "Name of the workspace-mcp server instance the Doc was found or created through, i.e. the <server> of the mcp__<server>__ tools in use"
    },
    "sync-mode": {
      type: "string",
      choices: Object.values(SyncMode),
      describe:
        "How the plan text reaches update_drive_file; defaults to the mode the review was created with"
    }
  }

  /** Message of the assertion guarding a target path with no Doc title. */
  export const MissingTitleMessage =
    "The review's Drive path carries no Doc title"

  /**
   * States that `--doc-id` is neither a Drive file id nor a canonical Google
   * Docs link.
   *
   * @param docId The value as the caller typed it.
   * @returns The assertion message.
   */
  export function newInvalidDocIdMessage(docId: string): string {
    return `--doc-id is not a Google Drive file id: ${docId}`
  }

  /**
   * States that `--doc-url` is not a canonical Google Docs link.
   *
   * @param docUrl The value as the caller typed it.
   * @returns The assertion message.
   */
  export function newInvalidDocUrlMessage(docUrl: string): string {
    return `--doc-url is not a https://docs.google.com/document/d/<id> link: ${docUrl}`
  }

  /**
   * States that `--folder-id` is not shaped like a Drive file id.
   *
   * @param folderId The value as the caller typed it.
   * @returns The assertion message.
   */
  export function newInvalidFolderIdMessage(folderId: string): string {
    return `--folder-id is not a Google Drive id: ${folderId} — pass the id a search or listing response named, not a folder name or "root"`
  }

  /**
   * States that `--drive-id` is not shaped like a Shared Drive id.
   *
   * @param driveId The value as the caller typed it.
   * @returns The assertion message.
   */
  export function newInvalidDriveIdMessage(driveId: string): string {
    return `--drive-id is not a Shared Drive id: ${driveId} — pass the id the list_drive_items response named`
  }

  /**
   * States that `--server` is not an MCP server instance name.
   *
   * @param serverName The value as the caller typed it.
   * @returns The assertion message.
   */
  export function newInvalidServerMessage(serverName: string): string {
    return `--server is not an MCP server instance name: ${serverName} — pass the <server> of the mcp__<server>__ tools you are calling, without the prefix`
  }

  /**
   * Reports whether a value is the bare name of an MCP server instance.
   *
   * The full `mcp__<server>__` prefix is refused explicitly, because pasting it
   * is the likely mistake and its only symptom would be a write gate that
   * silently never allows anything: the recorded name would match no call.
   *
   * @param serverName The value as the caller typed it.
   * @returns `true` when the value can be the `<server>` of a tool name.
   */
  export function isServerName(serverName: string): boolean {
    return (
      isNonEmptyString(serverName) &&
      serverName.length <= ReviewStateText.MaxServerNameLength &&
      ReviewStateText.ServerNameExpression.test(serverName) &&
      !serverName.startsWith(WorkspaceToolName.Prefix) &&
      !serverName.endsWith(WorkspaceToolName.Separator)
    )
  }

  /**
   * Derives the Doc title from the Drive folder path: its last segment.
   *
   * @param targetPath Drive folder path recorded by `init`.
   * @returns The Doc title.
   */
  export function titleOf(targetPath: string): string {
    const segments = String(targetPath)
      .split(PathSeparator)
      .filter(isNonEmptyString)
    return last(segments)
  }
}

/**
 * Builds the `register` command: the second half of `/gdoc-review` setup.
 *
 * It records the Doc the skill found or created, completes the Drive target
 * with the folder and Shared Drive ids, and flips the review to `active` —
 * which is the status the `ExitPlanMode` gate acts on. The id and the link are
 * validated against the canonical Google forms first: everything downstream
 * compares writes against this id. `--doc-id` is stored normalized to the bare
 * file id, so a `https://docs.google.com/document/d/<id>` link given there
 * records the same id an `update_drive_file` call carries, and the recorded
 * link is rebuilt from that id rather than stored as typed — the value the
 * caller passed is validated, never echoed.
 *
 * `--folder-id` and `--drive-id` are checked for **shape only** — a Drive file
 * id and a Shared Drive id respectively, the latter with a lower length floor
 * because Shared Drive ids are shorter. They are metadata the `status` report
 * prints; nothing is authorised by them, because the write gate compares every
 * later call against the registered Doc alone. An absent `--drive-id` keeps the
 * one already on the target rather than blanking it out.
 *
 * `--server` names the MCP server instance the Doc was found or created
 * through. It is recorded with the Doc and compared against the server of every
 * call the write gate considers, so a second connected workspace server — a
 * different Google account — cannot have a write waved through on the strength
 * of this registration.
 *
 * @returns The yargs command module.
 */
export function createRegisterCommand(): CommandModule<
  CliState.Arguments,
  RegisterCommandArguments
> {
  return {
    command: CliSubcommand.register,
    describe: RegisterCommand.Description,
    builder: RegisterCommand.OptionDefinitions,
    handler: async argv => {
      const planFile = resolvePlanFile(argv.plan),
        {
          "doc-id": docId,
          "doc-url": docUrl,
          "folder-id": folderId,
          "drive-id": driveId = null,
          server: serverName,
          "sync-mode": syncMode = null
        } = argv,
        store = await createCliStore(),
        state = await assertReviewState(store, planFile),
        title = RegisterCommand.titleOf(state.target.path),
        documentId = extractDocumentId(docId)

      Assert.ok(isNonEmptyString(title), RegisterCommand.MissingTitleMessage)
      Assert.ok(
        isNonEmptyString(documentId),
        RegisterCommand.newInvalidDocIdMessage(docId)
      )
      Assert.ok(
        isDocumentUrl(docUrl),
        RegisterCommand.newInvalidDocUrlMessage(docUrl)
      )
      Assert.ok(
        isDocumentId(folderId),
        RegisterCommand.newInvalidFolderIdMessage(folderId)
      )
      Assert.ok(
        driveId == null || isDriveId(driveId),
        RegisterCommand.newInvalidDriveIdMessage(driveId)
      )
      Assert.ok(
        RegisterCommand.isServerName(serverName),
        RegisterCommand.newInvalidServerMessage(serverName)
      )

      const next: ReviewState = {
        ...state,
        status: ReviewStatus.active,
        target: {
          ...state.target,
          folderId,
          driveId: isNonEmptyString(driveId) ? driveId : state.target.driveId
        },
        doc: {
          id: documentId,
          url: ToolResponseParsers.newDocumentUrl(documentId),
          title,
          serverName
        },
        syncMode: isNonEmptyString(syncMode) ? syncMode : state.syncMode
      }

      await store.save(next)
      printReviewState(next)
    }
  }
}
