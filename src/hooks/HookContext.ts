import path from "node:path"

import {
  PluginConfig,
  resolvePluginConfig,
  resolveStateDirectory
} from "../config/index.js"
import { getLogger } from "../logging/index.js"
import type { Logger } from "../logging/index.js"
import { PlanFileLocator } from "../plan/index.js"
import { PluginRoot, resolvePluginRoot } from "../plugin/index.js"
import { RoundProtocolRenderer } from "../round/index.js"
import { ReviewStateStore } from "../state/index.js"

/**
 * Everything a hook handler is allowed to touch. Handlers are pure over this
 * bundle plus their payload: no network, no MCP call and no stream write
 * happens inside one, so every decision is reproducible from a fixture.
 */
export interface HookContext {
  /** Reader and writer of `reviews/` and `sessions/`. */
  store: ReviewStateStore

  /** Resolved plugin configuration. */
  config: PluginConfig

  /** Plan-file discovery over the transcript and the sessions map. */
  locator: PlanFileLocator

  /** Renderer of the round protocol and the short gate reasons. */
  renderer: RoundProtocolRenderer

  /** Absolute paths of the launchers the Bash gate may auto-allow. */
  cliScriptFiles: string[]

  /** Clock; injected so recorded timestamps are deterministic in tests. */
  now: HookContext.Clock

  /** Logger every handler reports through; nothing reaches stdout. */
  log: Logger
}

/** Constants, sub-types and helpers of {@link HookContext}. */
export namespace HookContext {
  /** Source of the timestamps written into the review state. */
  export type Clock = () => Date

  /** Location of the committed bundle inside the plugin root. */
  export const BundleSubpath = PluginRoot.BundleSubpath

  /** Location of the plain-JS launcher inside the plugin root. */
  export const LauncherSubpath = path.join("bin", "gdoc-review")

  /** What the caller may inject; every field is resolved when omitted. */
  export interface Options {
    /** State directory holding `reviews/`, `sessions/` and the log. */
    stateDirectory?: string

    /** Root of the installed plugin, used for `ROUND.md` and the CLI paths. */
    pluginRoot?: string

    /** Pre-built state store. */
    store?: ReviewStateStore

    /** Pre-resolved configuration. */
    config?: PluginConfig

    /** Pre-built plan-file locator. */
    locator?: PlanFileLocator

    /** Pre-built round protocol renderer. */
    renderer?: RoundProtocolRenderer

    /** Launcher paths the Bash gate auto-allows. */
    cliScriptFiles?: string[]

    /** Clock used for recorded timestamps. */
    now?: Clock

    /** Logger handlers report through. */
    log?: Logger
  }

  /**
   * Reads the current time.
   *
   * @returns The system clock's `Date`.
   */
  export function systemClock(): Date {
    return new Date()
  }

  /**
   * Builds the launcher paths the Bash allow-list accepts.
   *
   * @param pluginRoot Root of the installed plugin.
   * @returns The bundle path and the `bin/` launcher path, in that order.
   */
  export function createCliScriptFiles(pluginRoot: string): string[] {
    return [
      path.join(pluginRoot, BundleSubpath),
      path.join(pluginRoot, LauncherSubpath)
    ]
  }
}

/**
 * Builds the dependency bundle handlers receive. Every field can be injected,
 * which is how tests drive the handlers against a temporary state directory
 * and a fixed clock.
 *
 * The logger is bound to the store's own state directory rather than the
 * environment-resolved one, so a context built around an injected store — the
 * CLI under `--state-dir`, a test — writes its diagnostics next to the state it
 * reads and writes, which is also the file the fail-closed deny names.
 *
 * @param options Overrides; anything omitted is resolved from the environment.
 * @returns The ready context.
 */
export async function createHookContext(
  options: HookContext.Options = {}
): Promise<HookContext> {
  const {
    stateDirectory = resolveStateDirectory(),
    pluginRoot = resolvePluginRoot(),
    store = await ReviewStateStore.create({ stateDirectory }),
    config = await resolvePluginConfig({ stateDirectory }),
    locator = new PlanFileLocator(store),
    renderer = new RoundProtocolRenderer({ pluginRoot }),
    cliScriptFiles = HookContext.createCliScriptFiles(pluginRoot),
    now = HookContext.systemClock,
    log: contextLog = getLogger(__filename, {
      stateDirectory: store.config.stateDirectory
    })
  } = options

  return {
    store,
    config,
    locator,
    renderer,
    cliScriptFiles,
    now,
    log: contextLog
  }
}
