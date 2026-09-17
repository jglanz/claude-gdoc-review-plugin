import { z } from "zod"

import { getValue, isNonEmptyString } from "../utils/index.js"

/**
 * What one `sessions/<session-id>` entry holds: the plan file a transcript scan
 * found, plus the transcript's size and modification time as they were when the
 * scan ran.
 *
 * The two transcript fields are what makes the entry a cache rather than a
 * second source of truth. A transcript that has not changed cannot name a
 * different plan, so the scan may be skipped; the moment it grows or is
 * rewritten the entry is stale and the scan runs again.
 */
export const SessionPlanRecordSchema = z.object({
  planFile: z.string().min(1),
  transcriptMtimeMs: z.number(),
  transcriptSize: z.number()
})

/** Cached transcript-scan result of one Claude session. */
export interface SessionPlanRecord extends z.infer<
  typeof SessionPlanRecordSchema
> {}

/** Validated JSON codec of {@link SessionPlanRecord}. */
export namespace SessionPlanRecordCodec {
  /** Indentation of the persisted JSON; the file is read by humans while debugging. */
  export const SerializeIndent = 2

  /**
   * Parses a sessions entry.
   *
   * Anything that is not a valid record — including the plain plan-file path
   * earlier versions wrote — is reported as "no entry", so a legacy or
   * hand-edited file is rescanned instead of trusted.
   *
   * @param text Content of a `sessions/<session-id>` file.
   * @returns The validated record, or `null` when the text is not one.
   */
  export function parse(text: string): SessionPlanRecord {
    if (!isNonEmptyString(text)) {
      return null
    }

    const value = getValue<unknown>(() => JSON.parse(text), null),
      result = SessionPlanRecordSchema.safeParse(value)

    return result.success ? result.data : null
  }

  /**
   * Serializes a sessions entry.
   *
   * @param record The record to persist.
   * @returns Pretty-printed JSON.
   */
  export function serialize(record: SessionPlanRecord): string {
    return JSON.stringify(
      SessionPlanRecordSchema.parse(record),
      null,
      SerializeIndent
    )
  }
}
