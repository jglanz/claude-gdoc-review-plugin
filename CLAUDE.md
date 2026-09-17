# claude-gdoc-review-plugin

Claude Code plugin: plan approval as a Google Doc review round (sync the plan
into a Doc, answer reviewer comments, custom approval menu). Runtime = one
committed bundle, `dist/gdoc-review.cjs`, invoked by `hooks/hooks.json` and by
the model through Bash.

**Binding companion:** [`STYLE.md`](STYLE.md) — every rule there applies to all
new code.

## Package manager and toolchain

**pnpm** only (`packageManager` pins the version). Node `>=24.9`. Never `npm` or
`yarn`.

```bash
pnpm install
pnpm build        # tsc -b (typecheck + lib/) then esbuild → dist/gdoc-review.cjs
pnpm lint         # eslint . (the house laws; zero tolerance, no exemption lists)
pnpm test         # build + jest (NODE_OPTIONS=--experimental-vm-modules)
pnpm format       # prettier
pnpm validate     # claude plugin validate . (skipped when the CLI is absent)
```

`pnpm validate` runs `claude plugin validate .` when the `claude` binary is on
PATH (and says so and exits 0 when it is not, so CI never depends on it). That
plain invocation is the gate: `--strict` is not used, because this contributor
file lives at the plugin root and is not shipped context.

`dist/gdoc-review.cjs` is committed: after any `src/` change run `pnpm build`
and include the regenerated bundle; CI fails on a stale bundle.

## Layout

- `src/` — TypeScript (CJS output to `lib/cjs`, never imported at runtime; the
  bundle is).
- `tests/` — mirrors `src/` one-to-one; `tests/fixtures/` holds hook payloads
  and a transcript sample; `tests/integration/` spawns the bundle.
- `skills/gdoc-review/` — `SKILL.md` (the `/gdoc-review` command) and `ROUND.md`
  (the review-round protocol rendered into hook deny reasons).
- `hooks/hooks.json`, `.claude-plugin/plugin.json`, `bin/gdoc-review` (plain-JS
  launcher).

## Invariants

- **Unit tests are mandatory for every created or modified symbol** — happy path
  plus at least one failure/edge case, in the same change, mirrored under
  `tests/`.
- **stdout is a protocol channel.** Hook and CLI JSON is the only thing written
  to stdout. Diagnostics go through the `tracer` file logger (`src/logging/`);
  `console.*` is banned.
- **No `src/` in any import specifier**; in-package imports carry `.js`; tests
  import the package through its self-alias.
- **No `@wireio/*` packages** and no external Google Workspace account other
  than the one configured for tests (`code/claude/wip/<Doc>` on the personal
  drive).
- **No git commits, pushes, or `gh` calls by agents.** Work stays in the working
  tree until the maintainer reviews it.
- Hook handlers must be pure over `(hook input, state file)`: no network, no MCP
  calls; every decision is unit-testable with a fixture payload.
- Every closed set is an identity string enum; `match()` from `ts-pattern` over
  `switch`.
