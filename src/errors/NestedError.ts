import { match, P } from "ts-pattern"

/**
 * Error wrapper that preserves the root cause and structured context.
 *
 * Every caught error re-thrown by this plugin is wrapped here instead of being
 * restrung into a bare `Error`: the cause keeps its own message and stack, and
 * the stack of the wrapper carries the cause's stack under a `Caused by:` line
 * so a single `log.error` in a hook shows the whole chain.
 */
export class NestedError extends Error {
  /** The error (or arbitrary thrown value) this one wraps; `null` when none was given. */
  readonly cause: unknown

  /** Structured key/value detail describing where the failure happened. */
  readonly context: NestedError.Context

  /**
   * @param message What failed, in the wrapper's own words.
   * @param options Cause and context; both fields are optional, the bag is not.
   */
  constructor(message: string, options: NestedError.Options) {
    const { cause = null, context = {} } = options
    super(message, { cause })

    this.name = NestedError.Name
    this.cause = cause
    this.context = context

    const causeStack = NestedError.stackOf(cause)
    if (causeStack.length > 0) {
      this.stack = `${this.stack}\n${NestedError.CausedByPrefix} ${causeStack}`
    }
  }
}

/** Constants and sub-types of {@link NestedError}. */
export namespace NestedError {
  /** Value assigned to `error.name`, so serialized errors stay identifiable. */
  export const Name = "NestedError"

  /** Line prefix introducing the cause's stack inside the wrapper's stack. */
  export const CausedByPrefix = "Caused by:"

  /** Structured detail attached to a {@link NestedError}. */
  export interface Context {
    [key: string]: unknown
  }

  /** Construction bag of {@link NestedError}. */
  export interface Options {
    /** The error or thrown value being wrapped. */
    cause?: unknown

    /** Structured detail describing where the failure happened. */
    context?: Context
  }

  /**
   * Renders any thrown value as the text appended after `Caused by:`.
   *
   * @param cause The wrapped value.
   * @returns The cause's stack, a printable form of a non-`Error` value, or an
   *   empty string when there is nothing to append.
   */
  export function stackOf(cause: unknown): string {
    return match(cause)
      .with(P.nullish, () => "")
      .with(
        P.instanceOf(Error),
        error => error.stack ?? `${error.name}: ${error.message}`
      )
      .otherwise(value => String(value))
  }
}
