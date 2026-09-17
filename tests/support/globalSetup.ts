import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * Prefix of the one directory a run owns, and the variable it is exported in.
 *
 * They are spelled here as well as in `testEnvironment.ts` because a Jest
 * global hook is loaded outside the test module registry: `moduleNameMapper`
 * does not apply to it, so it cannot import a sibling module — not with the
 * `.js` suffix the repository requires, and not without it either, since the
 * sibling is TypeScript. `testEnvironment.test.ts` asserts the two spellings
 * still agree.
 */
const RunDirectoryPrefix = "gdoc-review-run-",
  RunDirectoryEnvironmentKey = "GDOC_REVIEW_TEST_RUN_DIRECTORY"

/**
 * Creates the one temporary directory this run puts everything inside, and
 * exports its path.
 *
 * It runs in the Jest process, before any worker is forked, so every worker
 * inherits the variable and the `globalTeardown` — which runs in that same
 * process — reads exactly the directory the workers wrote into. Deriving the
 * path from process ancestry instead made the two sides agree only by
 * coincidence, and a run killed before its teardown used to be swept up by the
 * next run's glob, which is one run deleting another run's live state.
 *
 * `mkdtemp` gives the directory a name no concurrent run can produce and
 * creates it owner-only.
 *
 * @returns Nothing; the run directory is handed on through the environment.
 */
export default function createRunDirectory(): void {
  process.env[RunDirectoryEnvironmentKey] = mkdtempSync(
    path.join(tmpdir(), RunDirectoryPrefix)
  )
}
