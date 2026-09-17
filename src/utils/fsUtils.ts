import { randomBytes } from "node:crypto"
import { constants } from "node:fs"
import type { Stats } from "node:fs"
import {
  access,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises"
import path from "node:path"

import { NestedError } from "../errors/index.js"
import { guard } from "./asyncUtils.js"
import { isRecord } from "./typeUtils.js"

/** Constants of the filesystem helpers. */
export namespace FsUtils {
  /** Encoding of every text file the plugin reads or writes. */
  export const Encoding: BufferEncoding = "utf8"

  /** `error.code` Node reports for a path that does not exist. */
  export const NotFoundErrorCode = "ENOENT"

  /** Infix marking the scratch file of an in-flight atomic write. */
  export const TemporaryFileInfix = ".tmp-"

  /** Bytes of randomness in a temporary file name; enough to never collide between workers. */
  export const TemporaryFileEntropyBytes = 6

  /**
   * Mode every file the plugin writes is created with: owner read/write only.
   * Review state records which plan a machine is working on and which Doc it
   * syncs into, so it is not readable by other accounts on a shared host.
   */
  export const FileMode = 0o600

  /** Mode every directory the plugin creates is created with: owner-only. */
  export const DirectoryMode = 0o700
}

/**
 * Creates a directory and every missing parent, owner-only.
 *
 * @param directoryPath Absolute or relative directory path.
 * @returns The same path, so calls can be chained into a `path.join`.
 */
export async function ensureDirectory(directoryPath: string): Promise<string> {
  try {
    await mkdir(directoryPath, { recursive: true, mode: FsUtils.DirectoryMode })
    return directoryPath
  } catch (cause) {
    throw new NestedError(`Creating directory ${directoryPath} failed`, {
      cause,
      context: { directoryPath }
    })
  }
}

/**
 * Writes text through a sibling temporary file and a rename, so a reader never
 * observes a half-written state file and a crash never truncates the previous
 * content. The temporary file is created owner-only, and `rename` carries that
 * mode onto the destination.
 *
 * @param file Destination file.
 * @param text Full content to write.
 */
export async function writeFileAtomic(
  file: string,
  text: string
): Promise<void> {
  const directoryPath = path.dirname(file),
    entropy = randomBytes(FsUtils.TemporaryFileEntropyBytes).toString("hex"),
    temporaryFile = path.join(
      directoryPath,
      `${path.basename(file)}${FsUtils.TemporaryFileInfix}${process.pid}-${entropy}`
    )

  await ensureDirectory(directoryPath)
  try {
    await writeFile(temporaryFile, text, {
      encoding: FsUtils.Encoding,
      mode: FsUtils.FileMode
    })
    await rename(temporaryFile, file)
  } catch (cause) {
    await guard(() => unlink(temporaryFile))
    throw new NestedError(`Atomic write of ${file} failed`, {
      cause,
      context: { file, temporaryFile }
    })
  }
}

/**
 * Reads a UTF-8 text file, treating "does not exist" as a value rather than a
 * failure — the common case for state and config files on a first run.
 *
 * @param file File to read.
 * @returns The file's text, or `null` when it does not exist.
 */
export async function readTextFileOrNull(file: string): Promise<string> {
  try {
    return await readFile(file, FsUtils.Encoding)
  } catch (cause) {
    if (isRecord(cause) && cause.code === FsUtils.NotFoundErrorCode) {
      return null
    }
    throw new NestedError(`Reading ${file} failed`, {
      cause,
      context: { file }
    })
  }
}

/**
 * Reads a path's stats, treating "does not exist" — and any other reason the
 * path cannot be inspected — as a value rather than a failure.
 *
 * @param file Path to inspect.
 * @returns The stats, or `null` when the path cannot be read.
 */
export async function readFileStatsOrNull(file: string): Promise<Stats> {
  try {
    return await stat(file)
  } catch {
    return null
  }
}

/**
 * Tests whether a path is visible to this process.
 *
 * @param file Path to test.
 * @returns `true` when the path exists and is accessible.
 */
export async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK)
    return true
  } catch {
    return false
  }
}
