import Assert from "node:assert"
import { readdir } from "node:fs/promises"
import path from "node:path"

import { defaults } from "lodash"

import { resolveStateDirectory } from "../config/index.js"
import type { Logger } from "../logging/index.js"
import { getLogger } from "../logging/index.js"
import { PlanFileLocator } from "../plan/PlanFileLocator.js"
import {
  ensureDirectory,
  isNonEmptyString,
  readTextFileOrNull,
  writeFileAtomic
} from "../utils/index.js"
import { ReviewState, ReviewStateCodec } from "./ReviewState.js"
import { ReviewStatus } from "./ReviewStateEnums.js"
import type { SessionPlanRecord } from "./SessionPlanRecord.js"
import { SessionPlanRecordCodec } from "./SessionPlanRecord.js"

/**
 * Reader and writer of the plugin's state directory: one JSON document per
 * review under `reviews/`, and one cached transcript-scan result per Claude
 * session under `sessions/`. Every write goes through an atomic rename, so a
 * hook that dies mid-write never leaves a truncated document behind.
 *
 * **Serial hooks are assumed.** A review document is read, modified and written
 * whole, with no compare-and-swap: Claude Code runs the hooks of one session one
 * at a time, so the read and the write of a handler are never interleaved with
 * another handler's. Two sessions reviewing the *same* plan file concurrently
 * would share one document and could lose the older write — the last writer
 * wins, and the review it lands is internally consistent because it was
 * validated whole. Nothing here is safe to call from parallel workers against
 * one state directory.
 */
export class ReviewStateStore {
  /**
   * Creates a store and ensures its two sub-directories exist.
   *
   * @param options State directory override; defaults to the resolved one.
   * @returns The ready store.
   */
  static async create(
    options?: ReviewStateStore.Options
  ): Promise<ReviewStateStore> {
    const config = defaults(
      { ...options },
      createReviewStateStoreDefaultOptions()
    ) as ReviewStateStore.Config

    Assert.ok(
      isNonEmptyString(config.stateDirectory),
      "ReviewStateStore requires a state directory"
    )

    await ensureDirectory(
      path.join(config.stateDirectory, ReviewStateStore.ReviewsSubpath)
    )
    await ensureDirectory(
      path.join(config.stateDirectory, ReviewStateStore.SessionsSubpath)
    )

    return new ReviewStateStore(config)
  }

  private constructor(readonly config: ReviewStateStore.Config) {}

  /**
   * Logger of this store, bound to the directory it actually reads and writes
   * rather than the environment-resolved one — so a store opened under
   * `--state-dir X` reports into `X/log.jsonl`. `getLogger` caches per
   * directory and category, so asking on every call costs nothing.
   */
  private get log(): Logger {
    return getLogger(__filename, {
      stateDirectory: this.config.stateDirectory
    })
  }

  /**
   * Resolves the document path of one review.
   *
   * @param planSlug Review key produced by `PlanFileLocator.planSlug`.
   * @returns Absolute path of `reviews/<plan-slug>.json`.
   */
  reviewFile(planSlug: string): string {
    return path.join(
      this.config.stateDirectory,
      ReviewStateStore.ReviewsSubpath,
      `${ReviewStateStore.assertSafeName(planSlug)}${ReviewStateStore.ReviewFileExtension}`
    )
  }

  /**
   * Resolves the file caching a session's transcript-scan result.
   *
   * @param sessionId Claude session identifier.
   * @returns Absolute path of `sessions/<session-id>`.
   */
  sessionFile(sessionId: string): string {
    return path.join(
      this.config.stateDirectory,
      ReviewStateStore.SessionsSubpath,
      ReviewStateStore.assertSafeName(sessionId)
    )
  }

  /**
   * Loads one review.
   *
   * @param planSlug Review key produced by `PlanFileLocator.planSlug`.
   * @returns The validated state, or `null` when no review exists for the slug.
   */
  async load(planSlug: string): Promise<ReviewState> {
    const file = this.reviewFile(planSlug),
      text = await readTextFileOrNull(file)

    if (!isNonEmptyString(text)) {
      this.log.debug("No review state at %s", file)
      return null
    }
    return ReviewStateCodec.parse(text)
  }

  /**
   * Validates and atomically persists a review, keyed by its own plan file.
   *
   * @param state State to write.
   */
  async save(state: ReviewState): Promise<void> {
    Assert.ok(state != null, "ReviewStateStore.save requires a state")
    Assert.ok(
      isNonEmptyString(state.planFile),
      "A review state must carry its plan file"
    )

    const file = this.reviewFile(PlanFileLocator.planSlug(state.planFile))
    await writeFileAtomic(file, ReviewStateCodec.serialize(state))
    this.log.debug("Saved review state %s", file)
  }

  /**
   * Caches the plan file a transcript scan found, together with the transcript
   * stats it was found against, so a later hook can skip the scan while the
   * transcript is unchanged and still find the plan after a compaction.
   *
   * @param sessionId Claude session identifier.
   * @param record Plan file plus the transcript size and modification time.
   */
  async writeSessionPlanRecord(
    sessionId: string,
    record: SessionPlanRecord
  ): Promise<void> {
    Assert.ok(
      record != null && isNonEmptyString(record.planFile),
      "writeSessionPlanRecord requires a plan file"
    )
    await writeFileAtomic(
      this.sessionFile(sessionId),
      SessionPlanRecordCodec.serialize(record)
    )
  }

  /**
   * Reads the cached transcript-scan result of a session.
   *
   * @param sessionId Claude session identifier.
   * @returns The record, or `null` when the session has none and when the
   *   entry is not a valid record — an entry written by an older version held
   *   a bare path and carries no transcript stats to validate the cache with.
   */
  async readSessionPlanRecord(sessionId: string): Promise<SessionPlanRecord> {
    const text = await readTextFileOrNull(this.sessionFile(sessionId))
    return SessionPlanRecordCodec.parse(text)
  }

  /**
   * Lists every review currently in the `active` status.
   *
   * @returns The active reviews; unreadable documents are skipped with a warning.
   */
  async listActive(): Promise<ReviewState[]> {
    const reviewsPath = path.join(
        this.config.stateDirectory,
        ReviewStateStore.ReviewsSubpath
      ),
      entries = await readdir(reviewsPath),
      files = entries.filter(entry =>
        entry.endsWith(ReviewStateStore.ReviewFileExtension)
      ),
      states = await Promise.all(
        files.map(file => this.readReviewFile(path.join(reviewsPath, file)))
      )

    return states.filter(
      state => state != null && state.status === ReviewStatus.active
    )
  }

  private async readReviewFile(file: string): Promise<ReviewState> {
    const text = await readTextFileOrNull(file)
    if (!isNonEmptyString(text)) {
      return null
    }
    try {
      return ReviewStateCodec.parse(text)
    } catch (cause) {
      this.log.warn(
        "Skipping unreadable review state %s: %s",
        file,
        (cause as Error).message
      )
      return null
    }
  }
}

/**
 * Builds the default options of {@link ReviewStateStore}.
 *
 * @returns The resolved state directory.
 */
export function createReviewStateStoreDefaultOptions(): ReviewStateStore.Options {
  return { stateDirectory: resolveStateDirectory() }
}

/** Constants and sub-types of {@link ReviewStateStore}. */
export namespace ReviewStateStore {
  /** Sub-directory holding one JSON document per review. */
  export const ReviewsSubpath = "reviews"

  /** Sub-directory holding one cached transcript-scan result per Claude session. */
  export const SessionsSubpath = "sessions"

  /** Extension of a review document. */
  export const ReviewFileExtension = ".json"

  /**
   * Names accepted as a plan slug or session id. Anything else — a separator,
   * a traversal segment, an empty string — is refused before it reaches a
   * `path.join`, so an attacker-supplied slug cannot escape the state directory.
   */
  export const SafeNameExpression = /^(?!\.\.?$)[A-Za-z0-9._-]+$/

  /** What the caller may override when creating a store. */
  export interface Options {
    /** State directory; defaults to the resolved plugin state directory. */
    stateDirectory?: string
  }

  /** Fully resolved store configuration. */
  export interface Config extends Required<Options> {}

  /**
   * Fails fast on a name that must not become a path segment.
   *
   * @param name Plan slug or session id.
   * @returns The same name, once proven safe.
   */
  export function assertSafeName(name: string): string {
    Assert.ok(
      isNonEmptyString(name) && SafeNameExpression.test(name),
      `Unsafe review state name: ${name}`
    )
    return name
  }
}
