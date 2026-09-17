import type { HookOutput } from "../HookOutput.js"

/**
 * What every `handle<Name>` function returns: the hook result to print, or
 * `null` for "print nothing". Handlers never throw for an expected condition —
 * an unrecognized payload is answered with `HookOutput.none()`.
 */
export type HandlerResult = Promise<HookOutput.Any>
