import Assert from "node:assert"
import { createReadStream } from "node:fs"
import type { Stats } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"

import { NestedError } from "../errors/index.js"
import type { Logger } from "../logging/index.js"
import { getLogger } from "../logging/index.js"
import type { SessionPlanRecord } from "../state/SessionPlanRecord.js"
import type { ReviewStateStore } from "../state/ReviewStateStore.js"
import {
  fileExists,
  FsUtils,
  getValue,
  isNonEmptyString,
  isRecord,
  readFileStatsOrNull
} from "../utils/index.js"
import { sha256OfText } from "./PlanDigest.js"

/**
 * Finds the plan markdown file a hook or command is about.
 *
 * The authoritative source is the session transcript: Claude Code appends an
 * attachment line carrying `planFilePath` every time plan mode is entered, and
 * the last non-sub-agent one is the plan the main agent is presenting. The
 * sessions map never outranks it — it only caches what a scan found, keyed by
 * the transcript's size and modification time, and is consulted as a source of
 * its own when the transcript no longer names a plan at all.
 */
export class PlanFileLocator {
  /**
   * @param store Store consulted for the sessions-map fallback.
   */
  constructor(readonly store: ReviewStateStore) {}

  /**
   * Logger of this locator, bound to the state directory of the store it was
   * built around — the directory the invocation actually works against, which
   * `--state-dir` may have moved. A locator with no store falls back to the
   * resolved one.
   */
  private get log(): Logger {
    return getLogger(
      __filename,
      this.store == null
        ? {}
        : { stateDirectory: this.store.config.stateDirectory }
    )
  }

  /**
   * Streams a JSONL transcript and returns the plan file of its last plan-mode
   * attachment.
   *
   * Lines that are not valid JSON are skipped: a transcript being appended to
   * concurrently can end in a partial line. Lines longer than
   * {@link PlanFileLocator.MaxLineBytes} are skipped before parsing, so a
   * transcript carrying a huge pasted payload cannot make a hook spend the
   * session's hook budget parsing it.
   *
   * A scan that skipped such a line and then found nothing **throws**: the plan
   * it was looking for may have been inside the line it refused to read, so
   * "this session presents no plan" is not something the scan may conclude. The
   * `ExitPlanMode` gate turns that into its fail-closed deny; every recorder
   * runs inside the dispatcher's guard and simply records nothing.
   *
   * @param transcriptPath Absolute path of the session transcript.
   * @returns The plan file path, or `null` when the transcript has no
   *   main-agent plan-mode attachment.
   */
  async locateFromTranscript(transcriptPath: string): Promise<string> {
    if (
      !isNonEmptyString(transcriptPath) ||
      !(await fileExists(transcriptPath))
    ) {
      this.log.debug("No transcript to scan at %s", transcriptPath)
      return null
    }

    const stream = createReadStream(transcriptPath, {
        encoding: FsUtils.Encoding
      }),
      lines = createInterface({ input: stream, crlfDelay: Infinity })

    let planFile: string = null,
      skippedLineCount = 0
    try {
      for await (const line of lines) {
        if (
          Buffer.byteLength(line, FsUtils.Encoding) >
          PlanFileLocator.MaxLineBytes
        ) {
          skippedLineCount += 1
          this.log.debug(
            "Skipping oversized transcript line in %s",
            transcriptPath
          )
          continue
        }
        const candidate = PlanFileLocator.planFilePathOf(line)
        if (isNonEmptyString(candidate)) {
          planFile = candidate
        }
      }
    } finally {
      lines.close()
      stream.close()
    }

    if (planFile == null && skippedLineCount > 0) {
      throw new NestedError(
        PlanFileLocator.newSkippedLinesMessage(
          transcriptPath,
          skippedLineCount
        ),
        { context: { transcriptPath, skippedLineCount } }
      )
    }
    return planFile
  }

  /**
   * Resolves the plan file from, in order: an explicit `--plan` value, the
   * session transcript, and the cached sessions entry.
   *
   * The transcript is authoritative — it is the only source that says which
   * plan the main agent is presenting *now* — so a cached entry never outranks
   * it. The scan is nevertheless skipped when the cached entry was written
   * against exactly this transcript, by size and modification time: an
   * unchanged transcript cannot name a different plan, and the scan streams a
   * file that grows all session long and would otherwise be repeated by every
   * hook call. The entry is also the fallback for a transcript that no longer
   * names a plan at all, which is what a compaction leaves behind — and it is
   * re-stamped against the compacted transcript on the way out, so the fruitless
   * scan runs once rather than on every hook call of the rest of the session.
   *
   * @param input Whatever the caller knows about the session.
   * @returns The plan file path, or `null` when no source knows one.
   */
  async locate(input: PlanFileLocator.Input): Promise<string> {
    const { explicitPlanFile, transcriptPath, sessionId } = input ?? {}

    if (isNonEmptyString(explicitPlanFile)) {
      return explicitPlanFile
    }

    const cached = await this.readSessionPlanRecord(sessionId),
      transcriptStats = await readFileStatsOrNull(transcriptPath)

    if (PlanFileLocator.isCacheOf(cached, transcriptStats)) {
      this.log.debug(
        "Transcript of session %s is unchanged; reusing the cached plan file",
        sessionId
      )
      return cached.planFile
    }

    const fromTranscript = await this.locateFromTranscript(transcriptPath)
    if (isNonEmptyString(fromTranscript)) {
      await this.rememberSessionPlanFile(
        sessionId,
        fromTranscript,
        transcriptStats
      )
      return fromTranscript
    }

    if (cached != null) {
      this.log.debug(
        "Transcript of session %s names no plan; falling back to the cached plan file",
        sessionId
      )
      await this.rememberSessionPlanFile(
        sessionId,
        cached.planFile,
        transcriptStats
      )
      return cached.planFile
    }

    this.log.debug("No plan file could be located for session %s", sessionId)
    return null
  }

  private async readSessionPlanRecord(
    sessionId: string
  ): Promise<SessionPlanRecord> {
    if (!isNonEmptyString(sessionId) || this.store == null) {
      return null
    }

    const record = await this.store.readSessionPlanRecord(sessionId)
    if (record == null) {
      return null
    }
    if (await fileExists(record.planFile)) {
      return record
    }

    this.log.debug(
      "Session %s names a plan file that is gone: %s",
      sessionId,
      record.planFile
    )
    return null
  }

  private async rememberSessionPlanFile(
    sessionId: string,
    planFile: string,
    transcriptStats: Stats
  ): Promise<void> {
    if (
      !isNonEmptyString(sessionId) ||
      this.store == null ||
      transcriptStats == null
    ) {
      return
    }

    try {
      await this.store.writeSessionPlanRecord(sessionId, {
        planFile,
        transcriptMtimeMs: transcriptStats.mtimeMs,
        transcriptSize: transcriptStats.size
      })
    } catch (cause) {
      this.log.warn(
        "Caching the plan file of session %s failed: %s",
        sessionId,
        (cause as Error).message
      )
    }
  }
}

/** Constants, sub-types and pure helpers of {@link PlanFileLocator}. */
export namespace PlanFileLocator {
  /** Extension of a plan markdown file. */
  export const PlanFileExtension = ".md"

  /** `type` of a transcript line carrying an attachment. */
  export const TranscriptLineType = "attachment"

  /** `attachment.type` of the plan-mode attachment. */
  export const PlanModeAttachmentType = "plan_mode"

  /**
   * Largest transcript line that is worth parsing. A plan-mode attachment is a
   * few hundred bytes; anything past this is pasted content, and parsing it on
   * every hook call would cost more than it can ever return.
   */
  export const MaxLineBytes = 1_048_576

  /** Hexadecimal characters of the path digest appended to a review key. */
  export const SlugDigestLength = 8

  /** Characters a review key may not carry; each one is replaced by a dash. */
  export const UnsafeSlugCharacterExpression = /[^A-Za-z0-9._-]/g

  /**
   * States that a scan ran out of transcript after refusing to read part of it.
   *
   * @param transcriptPath Transcript that was scanned.
   * @param skippedLineCount Lines the scan refused to parse.
   * @returns The message of the error the scan fails with.
   */
  export function newSkippedLinesMessage(
    transcriptPath: string,
    skippedLineCount: number
  ): string {
    return `Found no plan file in ${transcriptPath} after skipping ${skippedLineCount} oversized line(s)`
  }

  /** What {@link PlanFileLocator.locate} may be given. */
  export interface Input {
    /** Plan file named on the command line; wins over every other source. */
    explicitPlanFile?: string

    /** Session transcript to scan. */
    transcriptPath?: string

    /** Claude session identifier, used for the sessions-map fallback. */
    sessionId?: string
  }

  /**
   * Reports whether a cached entry was written against exactly the transcript
   * that is on disk now, which is what makes skipping the scan safe.
   *
   * @param record The cached sessions entry, or `null`.
   * @param transcriptStats Stats of the transcript, or `null` when it is gone.
   * @returns `true` when both are present and the size and modification time
   *   are the ones the entry recorded.
   */
  export function isCacheOf(
    record: SessionPlanRecord,
    transcriptStats: Stats
  ): boolean {
    return (
      record != null &&
      transcriptStats != null &&
      record.transcriptMtimeMs === transcriptStats.mtimeMs &&
      record.transcriptSize === transcriptStats.size
    )
  }

  /**
   * Reads one transcript line and returns the plan file it announces.
   *
   * Sub-agent plan-mode attachments are ignored: a sub-agent's plan is not the
   * plan the user is reviewing.
   *
   * @param line One raw JSONL line.
   * @returns The plan file path, or `null` when the line is malformed or is
   *   not a main-agent plan-mode attachment.
   */
  export function planFilePathOf(line: string): string {
    const entry = getValue<unknown>(() => JSON.parse(line), null)
    if (!isRecord(entry) || entry.type !== TranscriptLineType) {
      return null
    }

    const { attachment } = entry
    if (
      !isRecord(attachment) ||
      attachment.type !== PlanModeAttachmentType ||
      attachment.isSubAgent !== false
    ) {
      return null
    }

    return isNonEmptyString(attachment.planFilePath)
      ? attachment.planFilePath
      : null
  }

  /**
   * Derives the review key from a plan file: its readable basename plus a short
   * digest of the absolute path.
   *
   * The digest is what makes the key identify one file rather than one file
   * name — two projects each with a `plan.md` are two reviews, and a plan file
   * placed somewhere else cannot inherit the recorded approval of another. The
   * basename is sanitised so the key is always a safe path segment.
   *
   * @param planFile Path of the plan markdown file; resolved before hashing.
   * @returns `<basename>-<first {@link SlugDigestLength} hex of sha256(path)>`.
   */
  export function planSlug(planFile: string): string {
    Assert.ok(isNonEmptyString(planFile), "planSlug requires a plan file path")

    const absoluteFile = path.resolve(planFile),
      name = path
        .basename(absoluteFile, PlanFileExtension)
        .replace(UnsafeSlugCharacterExpression, "-"),
      digest = sha256OfText(absoluteFile).slice(0, SlugDigestLength)

    return `${name}-${digest}`
  }
}
