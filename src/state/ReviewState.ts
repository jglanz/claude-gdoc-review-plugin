import Assert from "node:assert"

import { z } from "zod"

import { NestedError } from "../errors/index.js"
import { isNonEmptyString, isRecord, isString } from "../utils/index.js"
import {
  CommentAction,
  DriveKind,
  PermissionMode,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewStatus,
  SyncMode
} from "./ReviewStateEnums.js"

/**
 * Bounds and character classes of every free-text value a review persists.
 *
 * All of them reach the state file from outside the plugin — a tool response, a
 * command line the model composed — and all of them are printed again by
 * `status` or quoted in a hook message. Capping the length keeps the state file
 * bounded; refusing control characters keeps an escape sequence out of a report
 * a person reads in a terminal.
 */
export namespace ReviewStateText {
  /** Longest Doc title a review records; Drive itself allows far less than this. */
  export const MaxTitleLength = 300

  /** Longest Shared Drive name a review records. */
  export const MaxDriveNameLength = 300

  /** Longest Drive folder path a review records. */
  export const MaxPathLength = 1_024

  /** Longest Drive id, Doc id or folder id a review records. */
  export const MaxIdLength = 256

  /** Longest Doc link a review records. */
  export const MaxUrlLength = 2_048

  /** Longest MCP server instance name a review records. */
  export const MaxServerNameLength = 128

  /** Most comment threads a review keeps bookkeeping for; the oldest are dropped. */
  export const MaxComments = 500

  /** Highest code point of the C0 control block, which ends just below the space. */
  export const LastControlCode = 0x001f

  /** Code point of `DELETE`, where the C1 control range begins. */
  export const FirstHighControlCode = 0x007f

  /** Highest code point of the C1 control range. */
  export const LastHighControlCode = 0x009f

  /** Shape of a Google Docs comment id, which is a short opaque token. */
  export const CommentIdExpression = /^[A-Za-z0-9_-]{1,128}$/

  /** Shape of an MCP server instance name, as it appears in `mcp__<server>__…`. */
  export const ServerNameExpression = /^[A-Za-z0-9._-]+$/

  /** Message of the refinement that fires on an oversized comment map. */
  export const TooManyCommentsMessage = `A review records at most ${MaxComments} comment threads`

  /** Message of the refinement that fires on text carrying a control character. */
  export const UnprintableTextMessage =
    "A recorded value must carry no control character"

  /**
   * Reports whether one character is a C0 or C1 control character.
   *
   * The test is written over code points rather than as a pattern because a
   * regular expression carrying literal control characters is banned in this
   * repository — and reading it back is how a reviewer checks the range.
   *
   * @param character One character of a candidate value.
   * @returns `true` for a character a terminal would act on rather than print.
   */
  export function isControlCharacter(character: string): boolean {
    const code = character.codePointAt(0)
    return (
      code <= LastControlCode ||
      (code >= FirstHighControlCode && code <= LastHighControlCode)
    )
  }

  /**
   * Reports whether a value is text a terminal renders literally.
   *
   * @param value Candidate value, of any shape.
   * @returns `true` for a string carrying no control character.
   */
  export function isPrintableText(value: unknown): boolean {
    return isString(value) && !Array.from(value).some(isControlCharacter)
  }

  /**
   * Reduces an untrusted string to something the state file may hold and a
   * report may print: control characters removed, then truncated.
   *
   * @param value Candidate text, of any shape.
   * @param maxLength Longest result, in characters.
   * @returns The sanitised text; `""` for a value that is not a string.
   */
  export function sanitizeText(value: unknown, maxLength: number): string {
    return isNonEmptyString(value)
      ? Array.from(value)
          .filter(character => !isControlCharacter(character))
          .join("")
          .slice(0, maxLength)
      : ""
  }

  /**
   * Reports whether a value is a usable Google Docs comment id.
   *
   * @param value Candidate id, of any shape.
   * @returns `true` when the value matches {@link CommentIdExpression}.
   */
  export function isCommentId(value: unknown): boolean {
    return isNonEmptyString(value) && CommentIdExpression.test(value)
  }

  /**
   * Adds one comment record, dropping the oldest entries once the map is full.
   *
   * The map is bounded rather than allowed to grow: a review that runs for
   * hundreds of rounds would otherwise keep one entry per thread it ever
   * touched, and the bookkeeping is diagnostic — the gate never reads it.
   *
   * @param comments Comment records already on the review.
   * @param commentId Id of the thread that was just acted on.
   * @param record What was done to it.
   * @returns The merged map, at most {@link MaxComments} entries long.
   */
  export function appendCommentRecord(
    comments: Record<string, ReviewCommentRecord>,
    commentId: string,
    record: ReviewCommentRecord
  ): Record<string, ReviewCommentRecord> {
    const merged = { ...comments, [commentId]: record },
      keys = Object.keys(merged)

    if (keys.length <= MaxComments) {
      return merged
    }
    return Object.fromEntries(
      keys.slice(keys.length - MaxComments).map(key => [key, merged[key]])
    )
  }
}

/**
 * Where the Doc lives, as recorded by `/gdoc-review` setup.
 *
 * Every field is metadata: the `status` report prints it and the `register`
 * command completes it. Nothing here grants a write — the write gate compares
 * a call against the registered Doc and nothing else — so `driveId` and
 * `folderId` are validated for shape only, and the free text fields are
 * length-capped and stripped of control characters because they are echoed
 * into a report a person reads.
 */
export const ReviewTargetSchema = z.object({
  kind: z.enum(DriveKind),
  driveName: z
    .string()
    .max(ReviewStateText.MaxDriveNameLength)
    .refine(
      ReviewStateText.isPrintableText,
      ReviewStateText.UnprintableTextMessage
    )
    .nullable(),
  driveId: z.string().max(ReviewStateText.MaxIdLength).nullable(),
  path: z
    .string()
    .max(ReviewStateText.MaxPathLength)
    .refine(
      ReviewStateText.isPrintableText,
      ReviewStateText.UnprintableTextMessage
    ),
  folderId: z.string().max(ReviewStateText.MaxIdLength).nullable()
})

/** Resolved Drive target of a review. */
export interface ReviewTarget extends z.infer<typeof ReviewTargetSchema> {}

/**
 * Drops the keys an earlier design persisted on the target, so a review
 * document written before they were removed still parses.
 *
 * `createdFolderIds`, `knownFolderIds` and `observedIds` recorded the parents a
 * setup-phase write gate used to auto-allow a folder or Doc creation under.
 * That gate is gone — the two setup writes go through Claude Code's own
 * permission flow — so the keys grant nothing and are discarded rather than
 * migrated.
 *
 * @param value Candidate target, exactly as it came off disk.
 * @returns The candidate without the retired keys.
 */
function dropRetiredTargetKeys(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !ReviewState.RetiredTargetKeys.includes(key)
    )
  )
}

/** {@link ReviewTargetSchema} preceded by the retired-key drop. */
const MigratedReviewTargetSchema = z.preprocess(
  dropRetiredTargetKeys,
  ReviewTargetSchema
)

/**
 * The Google Doc a review syncs into.
 *
 * `serverName` is the MCP server instance the Doc was registered through, taken
 * from the `mcp__<server>__…` tool name. The write gate compares it against the
 * server of every call it considers auto-allowing, so a second connected
 * workspace server cannot have a write to this Doc waved through on the
 * strength of a registration made against another account's.
 */
export const ReviewDocSchema = z.object({
  id: z.string().max(ReviewStateText.MaxIdLength),
  url: z.string().max(ReviewStateText.MaxUrlLength),
  title: z
    .string()
    .max(ReviewStateText.MaxTitleLength)
    .refine(
      ReviewStateText.isPrintableText,
      ReviewStateText.UnprintableTextMessage
    ),
  serverName: z
    .string()
    .min(1)
    .max(ReviewStateText.MaxServerNameLength)
    .regex(ReviewStateText.ServerNameExpression)
})

/** Registered Doc of a review. */
export type ReviewDoc = z.infer<typeof ReviewDocSchema>

/** One successful sync of the plan file into the Doc. */
export const ReviewSyncRecordSchema = z.object({
  at: z.string(),
  planSha256: z.string(),
  revision: z.number().int()
})

/** Record of the last successful sync. */
export type ReviewSyncRecord = z.infer<typeof ReviewSyncRecordSchema>

/**
 * The user's answer on the approval menu, pinned to the plan revision it was
 * given for.
 *
 * `source` records who wrote it, `toolUseId` the `AskUserQuestion` call it came
 * from, and `consumedAt` the moment the permission hook spent it: an approval
 * is single-use, so the same recorded answer can never approve a second
 * `ExitPlanMode`.
 */
export const ReviewDecisionSchema = z.object({
  choice: z.enum(ReviewDecisionChoice),
  label: z.string(),
  text: z.string().nullable(),
  planSha256: z.string(),
  at: z.string(),
  source: z.enum(ReviewDecisionSource),
  toolUseId: z.string().nullable(),
  consumedAt: z.string().nullable()
})

/** Recorded menu answer. */
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>

/** What the plugin last did to one Doc comment thread. */
export const ReviewCommentRecordSchema = z.object({
  lastAction: z.enum(CommentAction),
  revision: z.number().int(),
  at: z.string()
})

/** Per-comment bookkeeping entry. */
export type ReviewCommentRecord = z.infer<typeof ReviewCommentRecordSchema>

/**
 * Per-comment bookkeeping, keyed by Google Docs comment id.
 *
 * The key is held to {@link ReviewStateText.CommentIdExpression} and the map to
 * {@link ReviewStateText.MaxComments} entries: the ids arrive from a tool
 * response and from the model's own arguments, and an unbounded map of
 * unbounded strings is a state file that grows without limit on a long review.
 */
export const ReviewCommentsSchema = z
  .record(
    z.string().regex(ReviewStateText.CommentIdExpression),
    ReviewCommentRecordSchema
  )
  .refine(
    comments => Object.keys(comments).length <= ReviewStateText.MaxComments,
    ReviewStateText.TooManyCommentsMessage
  )

/** The whole `reviews/<plan-slug>.json` document; the single source of truth for a review. */
export const ReviewStateSchema = z.object({
  version: z.number().int(),
  status: z.enum(ReviewStatus),
  planFile: z.string(),
  createdAt: z.string(),
  target: MigratedReviewTargetSchema,
  doc: ReviewDocSchema.nullable(),
  logCommentId: z
    .string()
    .regex(ReviewStateText.CommentIdExpression)
    .nullable(),
  syncMode: z.enum(SyncMode),
  revision: z.number().int(),
  lastSync: ReviewSyncRecordSchema.nullable(),
  decision: ReviewDecisionSchema.nullable(),
  comments: ReviewCommentsSchema,
  approvedAt: z.string().nullable(),
  approvedMode: z.enum(PermissionMode).nullable()
})

/** Persisted state of one review, as validated by {@link ReviewStateSchema}. */
export interface ReviewState extends z.infer<typeof ReviewStateSchema> {}

/** Constants and sub-types of {@link ReviewState}. */
export namespace ReviewState {
  /** Schema version of the persisted document; bump when a migration is needed. */
  export const Version = 1

  /**
   * Target keys an earlier design persisted and this one has no use for. They
   * recorded the Drive parents a setup-phase write gate trusted; that gate is
   * gone, so the keys are dropped on parse and never written.
   */
  export const RetiredTargetKeys: readonly string[] = [
    "createdFolderIds",
    "knownFolderIds",
    "observedIds"
  ]

  /** Revision number before the first sync. */
  export const InitialRevision = 0

  /** Indentation of the persisted JSON — the file is read by humans while debugging. */
  export const SerializeIndent = 2

  /** What `createInitialReviewState` needs; everything else starts empty. */
  export interface InitInput {
    /** Absolute path of the plan markdown file under review. */
    planFile: string

    /** Drive target resolved from the `/gdoc-review` arguments. */
    target: ReviewTarget

    /** Sync mode; defaults to inline content. */
    syncMode?: SyncMode
  }
}

/**
 * Builds the `setup` state written by the `init` command.
 *
 * @param input Plan file and Drive target.
 * @returns A validated initial state; the Doc is not registered yet.
 */
export function createInitialReviewState(
  input: ReviewState.InitInput
): ReviewState {
  const { planFile, target, syncMode = SyncMode.content } = input

  Assert.ok(
    isNonEmptyString(planFile),
    "createInitialReviewState requires a plan file"
  )
  Assert.ok(target != null, "createInitialReviewState requires a Drive target")

  return ReviewStateCodec.assertValid(
    {
      version: ReviewState.Version,
      status: ReviewStatus.setup,
      planFile,
      createdAt: new Date().toISOString(),
      target,
      doc: null,
      logCommentId: null,
      syncMode,
      revision: ReviewState.InitialRevision,
      lastSync: null,
      decision: null,
      comments: {},
      approvedAt: null,
      approvedMode: null
    },
    ReviewStateCodec.InitialSourceName
  )
}

/** Validated JSON codec of {@link ReviewState}; the only way state reaches or leaves disk. */
export namespace ReviewStateCodec {
  /** Source label used when the initial state fails its own schema. */
  export const InitialSourceName = "createInitialReviewState"

  /** Source label used when text read from disk fails validation. */
  export const TextSourceName = "review state text"

  /** Source label used when an in-memory state fails validation on the way out. */
  export const StateSourceName = "review state value"

  /**
   * Validates an untrusted value against {@link ReviewStateSchema}.
   *
   * @param value Candidate state.
   * @param source Label naming where the value came from, used in the error.
   * @returns The validated state.
   */
  export function assertValid(value: unknown, source: string): ReviewState {
    const result = ReviewStateSchema.safeParse(value)
    if (!result.success) {
      throw new NestedError(`Review state from ${source} failed validation`, {
        cause: result.error,
        context: { source }
      })
    }
    return result.data
  }

  /**
   * Parses persisted JSON into a validated state.
   *
   * @param text Content of a `reviews/<plan-slug>.json` file.
   * @returns The validated state.
   */
  export function parse(text: string): ReviewState {
    Assert.ok(isNonEmptyString(text), "ReviewStateCodec.parse requires text")

    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (cause) {
      throw new NestedError("Review state is not valid JSON", {
        cause,
        context: { text }
      })
    }
    return assertValid(value, TextSourceName)
  }

  /**
   * Serializes a state after validating it, so an invalid document can never
   * be written.
   *
   * @param state State to persist.
   * @returns Pretty-printed JSON.
   */
  export function serialize(state: ReviewState): string {
    return JSON.stringify(
      assertValid(state, StateSourceName),
      null,
      ReviewState.SerializeIndent
    )
  }
}
