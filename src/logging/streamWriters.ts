import { FsUtils } from "../utils/fsUtils.js"

/** Constants of the standard-stream writers. */
export namespace StreamWriters {
  /** Line terminator callers append when they write a whole line. */
  export const LineSeparator = "\n"
}

/**
 * Writes protocol output to stdout.
 *
 * This is the only place in the plugin that touches `process.stdout`: stdout
 * carries the hook and CLI JSON, so every other module goes through this
 * function (for protocol output) or through {@link getLogger} (for
 * diagnostics). The text is written verbatim — the caller decides whether it
 * ends in {@link StreamWriters.LineSeparator}.
 *
 * @param text Exact bytes to write.
 */
export function writeStdout(text: string): void {
  process.stdout.write(text, FsUtils.Encoding)
}

/**
 * Writes an operator-facing error line to stderr.
 *
 * stderr is never part of the hook protocol, so a CLI failure can be reported
 * there without corrupting stdout. Diagnostics still belong in the log file;
 * this is for the message that accompanies a non-zero exit code.
 *
 * @param text Exact bytes to write.
 */
export function writeStderr(text: string): void {
  process.stderr.write(text, FsUtils.Encoding)
}
