import Assert from "node:assert"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

import { GDocReview } from "../Constants.js"
import { getLogger } from "../logging/index.js"
import { isNonEmptyString } from "../utils/index.js"

/** Constants of the plugin-root resolution. */
export namespace PluginRoot {
  /** Location of the protocol template inside the plugin bundle. */
  export const TemplateSubpath = "skills/gdoc-review/ROUND.md"

  /** Location of the committed runtime bundle inside the plugin bundle. */
  export const BundleSubpath = "dist/gdoc-review.cjs"

  /**
   * Everything an installed plugin root must hold. A directory missing either
   * of them is not this plugin: the renderer would find no protocol template,
   * and the Bash allow-list would be built around a launcher path that does
   * not exist, so it would auto-allow nothing.
   */
  export const RequiredSubpaths: readonly string[] = [
    TemplateSubpath,
    BundleSubpath
  ]

  /** How many ancestors {@link findPluginRoot} inspects above the start directory. */
  export const MaxAncestorDepth = 4

  /** Logged when `CLAUDE_PLUGIN_ROOT` names a directory that is not an installed plugin. */
  export const ForeignRootMessage =
    "CLAUDE_PLUGIN_ROOT does not hold this plugin; resolving the root from this module instead:"
}

/**
 * Reports whether a directory holds every file an installed plugin root has.
 *
 * @param candidate Directory to inspect.
 * @returns `true` when all of {@link PluginRoot.RequiredSubpaths} are present.
 */
export function isPluginRoot(candidate: string): boolean {
  return (
    isNonEmptyString(candidate) &&
    PluginRoot.RequiredSubpaths.every(subpath =>
      existsSync(resolve(candidate, subpath))
    )
  )
}

/**
 * Walks up from a directory to the nearest ancestor that is an installed plugin
 * root, so the same code locates it from the TypeScript sources, the compiled
 * `lib/` tree, and the single-file `dist/` bundle.
 *
 * An ancestor qualifies on exactly the test {@link isPluginRoot} applies to the
 * environment variable: a directory holding the protocol template but no bundle
 * is a partial checkout, and returning it would hand the Bash allow-list a
 * launcher path that does not exist.
 *
 * @param startDirectory Directory to start from (normally `__dirname`).
 * @returns The plugin root; falls back to the start directory when no ancestor
 *   is one.
 */
export function findPluginRoot(startDirectory: string): string {
  Assert.ok(
    startDirectory,
    "A start directory is required to find the plugin root"
  )

  const candidates = [
      startDirectory,
      ...Array.from(
        { length: PluginRoot.MaxAncestorDepth },
        (_, depth) => depth + 1
      ).map(depth =>
        resolve(startDirectory, ...Array.from({ length: depth }, () => ".."))
      )
    ],
    found = candidates.find(isPluginRoot)

  return found ?? startDirectory
}

/**
 * Resolves the installed plugin's root: the environment variable Claude Code
 * sets, falling back to the nearest ancestor of this module that holds the
 * protocol template.
 *
 * Every consumer — the hook context and the round protocol renderer — goes
 * through this one function, so the environment variable is read in exactly one
 * place and the two can never disagree about where the plugin is installed.
 *
 * The environment variable is trusted only when the directory it names actually
 * holds this plugin. A value left over from another plugin, or pointing at a
 * directory that has since moved, would otherwise silently disable both the
 * protocol renderer and the Bash allow-list; the walk from this module finds
 * the real root in that case, and the mismatch is logged.
 *
 * @returns Absolute path of the plugin root.
 */
export function resolvePluginRoot(): string {
  const { [GDocReview.PluginRootEnvironmentKey]: pluginRootFromEnvironment } =
    process.env

  if (!isNonEmptyString(pluginRootFromEnvironment)) {
    return findPluginRoot(__dirname)
  }
  if (isPluginRoot(pluginRootFromEnvironment)) {
    return pluginRootFromEnvironment
  }

  // The logger is made here rather than at module scope, and with no explicit
  // directory: this module is loaded before the invocation has resolved which
  // state directory it works against, and by the time the warning is written
  // `resolveStateDirectory` answers with the directory `--state-dir` named. A
  // module-scope logger would have been bound to the environment's directory at
  // import time, which is not the log the operator of this invocation reads.
  // `getLogger` caches per directory, so asking for it here costs nothing.
  getLogger(__filename).warn(
    "%s %s",
    PluginRoot.ForeignRootMessage,
    pluginRootFromEnvironment
  )
  return findPluginRoot(__dirname)
}
