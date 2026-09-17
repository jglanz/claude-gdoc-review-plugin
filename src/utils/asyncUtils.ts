/** A side effect whose outcome the caller does not consume. */
export type GuardedEffect = () => unknown

/** A computation whose failure the caller replaces with a fallback value. */
export type ValueProducer<T> = () => T

/**
 * Runs a best-effort side effect and swallows whatever it throws or rejects
 * with. Use it only where the outcome genuinely does not matter — cleanup of a
 * temporary file, a diagnostic write — never to hide an I/O error a caller
 * needs to see.
 *
 * @param effect Synchronous or asynchronous side effect.
 * @returns A promise that always fulfils.
 */
export async function guard(effect: GuardedEffect): Promise<void> {
  try {
    await effect()
  } catch {
    // Swallowed by contract: the caller opted out of this effect's outcome.
  }
}

/**
 * Runs a synchronous computation and substitutes a fallback when it throws.
 *
 * @param produce The computation, e.g. `() => JSON.parse(line)`.
 * @param fallback Value returned when `produce` throws.
 * @returns The produced value, or `fallback`.
 */
export function getValue<T>(produce: ValueProducer<T>, fallback: T): T {
  try {
    return produce()
  } catch {
    return fallback
  }
}
