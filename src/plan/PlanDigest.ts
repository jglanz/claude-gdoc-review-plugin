import Assert from "node:assert"
import type { BinaryToTextEncoding } from "node:crypto"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { NestedError } from "../errors/index.js"
import { getLogger } from "../logging/index.js"
import { FsUtils, isRecord, isString } from "../utils/index.js"

/** Constants of the plan digest. */
export namespace PlanDigest {
  /** Hash algorithm pinning plan text to a Doc revision. */
  export const Algorithm = "sha256"

  /** Digest encoding stored in the review state. */
  export const Encoding: BinaryToTextEncoding = "hex"
}

/**
 * Hashes plan text.
 *
 * The digest is what the `ExitPlanMode` gate compares against
 * `lastSync.planSha256` to decide whether the Doc is current, and what a sync
 * PostToolUse hook compares against the content actually sent to Drive.
 *
 * @param text Plan markdown.
 * @returns Lower-case hexadecimal SHA-256 digest.
 */
export function sha256OfText(text: string): string {
  Assert.ok(isString(text), "sha256OfText requires text")
  return createHash(PlanDigest.Algorithm)
    .update(text, FsUtils.Encoding)
    .digest(PlanDigest.Encoding)
}

/**
 * Hashes the content of a file, producing the same digest
 * {@link sha256OfText} produces for its text.
 *
 * @param file Absolute path of the plan markdown file.
 * @returns The digest, or `null` when the file does not exist — a plan can be
 *   registered before it is first written.
 */
export async function sha256OfFile(file: string): Promise<string> {
  Assert.ok(isString(file), "sha256OfFile requires a file path")
  try {
    const content = await readFile(file)
    return createHash(PlanDigest.Algorithm)
      .update(content)
      .digest(PlanDigest.Encoding)
  } catch (cause) {
    if (isRecord(cause) && cause.code === FsUtils.NotFoundErrorCode) {
      // The logger is made here rather than at module scope: this module is
      // loaded before the invocation has resolved which state directory it
      // works against, and the line belongs in that directory's log.
      getLogger(__filename).debug("No plan file to hash at %s", file)
      return null
    }
    throw new NestedError(`Hashing ${file} failed`, {
      cause,
      context: { file }
    })
  }
}
