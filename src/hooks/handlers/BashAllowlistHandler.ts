import path from "node:path"

import { PlanFileLocator } from "../../plan/index.js"
import {
  CliSubcommand,
  createCliAllowlistMatcher,
  isNonEmptyString,
  isString
} from "../../utils/index.js"
import type { HookContext } from "../HookContext.js"
import type { PreToolUseHookInput } from "../HookInput.js"
import { HookOutput } from "../HookOutput.js"
import type { HandlerResult } from "./HandlerResult.js"

/** Constants and message builders of the Bash allow-list gate. */
export namespace BashAllowlistHandler {
  /** Reason attached to an auto-allowed CLI invocation. */
  export const AllowReason = "gdoc-review CLI"

  /**
   * The only `permission_mode` in which this gate grants anything. Outside plan
   * mode Bash is not blanket-prompted, so auto-allowing buys nothing and would
   * only widen what an unattended session can run; a payload that carries no
   * mode at all is treated the same way.
   */
  export const PlanPermissionMode = "plan"

  /** The one subcommand allowed before any review exists — it is what creates one. */
  export const SetupSubcommand = CliSubcommand.init

  /**
   * Reports a command whose `--plan` names a plan other than the one the
   * session is presenting.
   *
   * @param claimedPlanFile Plan the command line named, made absolute.
   * @param locatedPlanFile Plan the session is presenting.
   * @returns The warning written to the log.
   */
  export function newForeignPlanMessage(
    claimedPlanFile: string,
    locatedPlanFile: string
  ): string {
    return `gdoc-review CLI call names plan ${claimedPlanFile}, but this session is presenting ${locatedPlanFile}; not auto-allowed`
  }

  /**
   * Reports a session whose plan file could not be located at all.
   *
   * @param sessionId Claude session the call came from.
   * @returns The message written to the log.
   */
  export function newUnknownPlanMessage(sessionId: string): string {
    return `No plan file located for session ${sessionId}; no gdoc-review CLI call is auto-allowed`
  }
}

async function hasReviewState(
  context: HookContext,
  planFile: string
): Promise<boolean> {
  if (!isNonEmptyString(planFile)) {
    return false
  }
  const state = await context.store.load(PlanFileLocator.planSlug(planFile))
  return state != null
}

function isSamePlanFile(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right)
}

/**
 * Auto-allows this plugin's own CLI invocations and nothing else. The model
 * runs `init`, `register`, `log-thread` and `status` through Bash
 * while the session is in plan mode, where every Bash call would otherwise
 * prompt.
 *
 * The grant is deliberately narrow. It applies only in plan mode, which is the
 * only mode whose blanket prompt it exists to relieve, and only for a plan that
 * already has a review — except `init`, which is what creates one. So the
 * allow-list can never be reached in an ordinary session, and never for a plan
 * the user has not opted into.
 *
 * This handler reads the session's plan file and never writes it. The plan a
 * session is presenting is a fact about the transcript, not about a command
 * line: recording a `--plan` value here would let the model name a plan of its
 * own and have every later hook believe it. A command whose `--plan` disagrees
 * with the located plan is refused outright rather than resolved in either
 * direction, because one of the two is wrong and the gate cannot tell which.
 *
 * For the same reason a session with no located plan gets nothing, `init`
 * included. Without a plan-mode attachment there is no plan the user put in
 * front of the model, so a `--plan` on the command line would be the only
 * source — exactly the claim this handler refuses to act on. The call still
 * runs, through the ordinary Bash prompt.
 *
 * @param input The `PreToolUse` payload of the Bash call.
 * @param context Store, locator and allow-listed launcher paths.
 * @returns An allow for a recognized CLI command, nothing for anything else.
 */
export async function handleBashAllowlist(
  input: PreToolUseHookInput,
  context: HookContext
): HandlerResult {
  const { command } = input.tool_input
  if (
    !isString(command) ||
    input.permission_mode !== BashAllowlistHandler.PlanPermissionMode
  ) {
    return HookOutput.none()
  }

  const verdict = createCliAllowlistMatcher(context.cliScriptFiles)(command)
  if (!verdict.allowed) {
    return HookOutput.none()
  }

  const { cwd = "" } = input,
    locatedPlanFile = await context.locator.locate({
      explicitPlanFile: null,
      transcriptPath: input.transcript_path,
      sessionId: input.session_id
    }),
    claimedPlanFile = isNonEmptyString(verdict.planFile)
      ? path.resolve(cwd, verdict.planFile)
      : null

  if (!isNonEmptyString(locatedPlanFile)) {
    context.log.debug(
      "%s",
      BashAllowlistHandler.newUnknownPlanMessage(input.session_id)
    )
    return HookOutput.none()
  }

  if (
    claimedPlanFile != null &&
    !isSamePlanFile(claimedPlanFile, locatedPlanFile)
  ) {
    context.log.warn(
      "%s",
      BashAllowlistHandler.newForeignPlanMessage(
        claimedPlanFile,
        locatedPlanFile
      )
    )
    return HookOutput.none()
  }

  if (
    verdict.subcommand !== BashAllowlistHandler.SetupSubcommand &&
    !(await hasReviewState(context, locatedPlanFile))
  ) {
    context.log.debug(
      "No review state for %s, gdoc-review CLI call not auto-allowed",
      locatedPlanFile
    )
    return HookOutput.none()
  }

  context.log.debug("Allowed gdoc-review CLI subcommand %s", verdict.subcommand)
  return HookOutput.preToolUseAllow(BashAllowlistHandler.AllowReason)
}
