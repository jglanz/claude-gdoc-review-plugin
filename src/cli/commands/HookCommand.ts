import path from "node:path"

import type { CommandModule, Options } from "yargs"
import { z } from "zod"

import {
  createHookContext,
  dispatchHook,
  ExitPlanModeGateHandler,
  HookEventName,
  HookOutput,
  HostToolName,
  parseHookInput
} from "../../hooks/index.js"
import { getLogger, Logger } from "../../logging/index.js"
import {
  FsUtils,
  getValue,
  isNonEmptyString,
  readTextFileOrNull
} from "../../utils/index.js"
import type { CliState } from "../CliState.js"
import {
  createCliHookContextOptions,
  resolveCliStateDirectory
} from "../CliState.js"
import { printLine } from "../commandSupport.js"

/**
 * Name of the hook entry point.
 *
 * Deliberately NOT a `CliSubcommand`: that enum drives the PreToolUse Bash
 * allow-list, and the model must never be able to run the hook entry point
 * itself through Bash.
 */
export enum HookCommandName {
  hook = "hook"
}

/** Arguments of the `hook` command. */
export interface HookCommandArguments extends CliState.Arguments {
  /** File to read the payload from instead of stdin; for debugging a recorded payload. */
  input?: string
}

/** Constants of the `hook` command. */
export namespace HookCommand {
  /** One-line description shown in `--help`. */
  export const Description =
    "Run one Claude Code hook: read the payload from stdin, print the hook JSON"

  /** Option definitions, collocated with the handler. */
  export const OptionDefinitions: Record<string, Options> = {
    input: {
      type: "string",
      describe:
        "Read the hook payload from this file instead of stdin (debugging)"
    }
  }

  /** Logged when a payload could not be handled; the hook still succeeds. */
  export const FailureMessage = "gdoc-review hook failed"

  /** Logged when there was no payload to handle at all. */
  export const EmptyPayloadMessage = "gdoc-review hook received no payload"

  /**
   * Logged when the payload itself could not be read.
   *
   * It is logged at `error` rather than `debug`: this is the one failure the
   * `ExitPlanMode` gate is answered with silence, because the event cannot be
   * identified without the payload that failed to arrive, so the log line is
   * the only trace a plan was waved through without the gate ever running.
   */
  export const UnreadablePayloadMessage =
    "gdoc-review hook could not read its payload"

  /**
   * The one question that has to be answered before the payload is trusted:
   * is this the event whose failure must fail closed?
   *
   * It is deliberately looser than {@link parseHookInput} — two literal fields,
   * every other key ignored — because it decides what to do when the strict
   * parse itself fails. A payload Claude Code will treat as a plan approval
   * must be recognisable even when it carries a field this plugin's schema does
   * not yet know.
   */
  export const GatedEventSchema = z.object({
    hook_event_name: z.literal(HookEventName.PreToolUse),
    tool_name: z.literal(HostToolName.ExitPlanMode)
  })

  /**
   * Reports whether a raw payload is the gated `ExitPlanMode` call.
   *
   * @param json Parsed stdin JSON, or `null` when it did not parse.
   * @returns `true` when the payload names a `PreToolUse` on `ExitPlanMode`.
   */
  export function isGatedEvent(json: unknown): boolean {
    return GatedEventSchema.safeParse(json).success
  }

  /**
   * Resolves the diagnostic log file named in a fail-closed deny.
   *
   * It names the same file the gate's own failure reason does — the state
   * directory this invocation works against, which `--state-dir` may have
   * moved — and answers with the bare file name if even that throws: this runs
   * on the path where everything else already failed, so it must not be able
   * to fail in turn.
   *
   * @returns Absolute path of `log.jsonl`, or its bare name.
   */
  export function resolveFailureLogFile(): string {
    return getValue(
      () => Logger.newLogFile(resolveCliStateDirectory()),
      Logger.FileName
    )
  }

  /**
   * Builds what a payload must be answered with when the hook could not run at
   * all.
   *
   * Only the `ExitPlanMode` gate gets an answer. Every other handler records
   * bookkeeping, and printing nothing leaves Claude Code exactly as it would
   * have behaved without this plugin; for the gate, printing nothing would let
   * a plan be approved without the review round it exists to enforce.
   *
   * @param gated Whether the payload was recognised as the gated event.
   * @returns A deny for a gated `ExitPlanMode`, nothing for anything else.
   */
  export function newFailureOutputForRaw(gated: boolean): HookOutput.Any {
    return gated
      ? HookOutput.preToolUseDeny(
          ExitPlanModeGateHandler.newFailureReason(resolveFailureLogFile())
        )
      : HookOutput.none()
  }
}

async function readStdinText(): Promise<string> {
  const { stdin } = process
  if (stdin.isTTY) {
    return ""
  }

  const chunks: Buffer[] = []
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString(FsUtils.Encoding)
}

/**
 * Reads the raw payload, answering an unreadable one with `null`.
 *
 * Everything else the hook does runs inside a guard that can still tell which
 * event it was handling and therefore whether the failure has to be answered
 * with a deny. This read cannot: the event is spelled inside the payload, so a
 * read that fails leaves nothing to identify it by. It is **the one silent case
 * for the gate** — an `ExitPlanMode` whose payload never arrived is answered
 * with silence, which lets Claude Code's own dialog take over, and the failure
 * is recorded at `error` so it is not invisible.
 */
async function readPayloadTextOrNull(
  inputFile: string,
  log: Logger
): Promise<string> {
  try {
    return isNonEmptyString(inputFile)
      ? await readTextFileOrNull(path.resolve(inputFile))
      : await readStdinText()
  } catch (cause) {
    log.error(
      "%s: %s",
      HookCommand.UnreadablePayloadMessage,
      cause instanceof Error ? cause.message : String(cause)
    )
    return null
  }
}

function printOutput(output: HookOutput.Any): void {
  const serialized = HookOutput.serialize(output)
  if (isNonEmptyString(serialized)) {
    printLine(serialized)
  }
}

function createHookLogger(): Logger {
  return getLogger(__filename, { stateDirectory: resolveCliStateDirectory() })
}

async function runHook(inputFile: string): Promise<void> {
  const log = createHookLogger(),
    text = await readPayloadTextOrNull(inputFile, log)

  if (!isNonEmptyString(text)) {
    log.debug(HookCommand.EmptyPayloadMessage)
    return
  }

  const json = getValue<unknown>(() => JSON.parse(text), null),
    gated = HookCommand.isGatedEvent(json)

  try {
    const input = parseHookInput(json),
      context = await createHookContext(createCliHookContextOptions())

    printOutput(await dispatchHook(input, context))
  } catch (cause) {
    log.error(
      "%s: %s",
      HookCommand.FailureMessage,
      cause instanceof Error ? cause.message : String(cause)
    )
    printOutput(HookCommand.newFailureOutputForRaw(gated))
  }
}

/**
 * Builds the `hook` command — the entry point every `hooks/hooks.json` entry
 * invokes.
 *
 * Nothing that happens inside it may break the session it is meant to help, so
 * every failure — unreadable stdin, malformed JSON, an unknown event, a
 * handler that threw — is logged to `log.jsonl` and answered with exit code 0,
 * which leaves Claude Code's own behaviour in place. A result is printed only
 * when a handler produced one.
 *
 * The event is identified as early as it can be, by
 * {@link HookCommand.GatedEventSchema} over the raw JSON: a two-field check
 * that cannot fail the way the strict parse can. Only the read of the payload
 * itself happens before that, because the event is spelled inside it; that read
 * is the one place a failure is answered with silence even for the gate, and it
 * is logged at `error` for exactly that reason. Everything that can fail —
 * the strict parse, building the context, dispatching — then runs inside one
 * guard, and a failure is answered in terms of the event it belonged to. A
 * `PreToolUse` on `ExitPlanMode` is denied through
 * {@link HookCommand.newFailureOutputForRaw} rather than waved through, because
 * for that one event "print nothing" means "approve the plan unreviewed"; a
 * payload that is not that event, or is too malformed to identify at all, is
 * answered with silence, which is all that can be said about it.
 *
 * @returns The yargs command module.
 */
export function createHookCommand(): CommandModule<
  CliState.Arguments,
  HookCommandArguments
> {
  return {
    command: HookCommandName.hook,
    describe: HookCommand.Description,
    builder: HookCommand.OptionDefinitions,
    handler: async argv => {
      try {
        await runHook(argv.input)
      } catch (cause) {
        createHookLogger().warn(
          "%s: %s",
          HookCommand.FailureMessage,
          cause instanceof Error ? cause.message : String(cause)
        )
      }
    }
  }
}
