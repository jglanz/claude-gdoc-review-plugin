/**
 * Narrows an unknown value to a string.
 *
 * @param value Candidate of any shape.
 * @returns `true` when the value is a primitive string.
 */
export function isString(value: unknown): value is string {
  return typeof value === "string"
}

/**
 * Narrows an unknown value to a string carrying at least one character.
 *
 * Used everywhere a `null`, an absent JSON field and an empty string all mean
 * "no value" — the plugin treats them identically.
 *
 * @param value Candidate of any shape.
 * @returns `true` when the value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0
}

/**
 * Narrows an unknown value to a plain keyed object.
 *
 * Arrays and `null` are rejected, so the result can be indexed by string key
 * while parsing untrusted JSON (transcript lines, tool responses, error codes).
 *
 * @param value Candidate of any shape.
 * @returns `true` when the value is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
