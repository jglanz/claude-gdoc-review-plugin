# TypeScript Style Guide

Binding conventions for this repository. The lint configuration
(`eslint.config.mjs`) mechanically enforces the "Mechanical style laws" section;
everything else is enforced in review. The compiler runs with `strict: false` /
`strictNullChecks: false`, which changes what some rules buy — read the `null`
section before writing `| null` anywhere.

---

## 1. Pattern matching with `ts-pattern`

- **`match()` over `switch`, always** (`BanSwitch`). When branching produces a
  value, assign the `match()` expression to a `const`. Use `.with()` per known
  variant, `.otherwise()` for the fallback, `.exhaustive()` on unions and enums.
- **`P.*` for type/shape narrowing in match position**: `P.string`, `P.number`,
  `P.nullish`, `P.array(P.string)`, `P.union(...)`, `P.when(pred)` as the escape
  hatch. Standalone guards outside match position stay plain
  (`if (!isString(x)) throw`).
- Async arms are fine — `await` the whole `match(...)` expression.
- Keep each arm focused; past ~15 lines extract a named helper.

## 2. Functional pipelines with `@3fv/prelude-ts`

- `asOption(value)` to wrap → `.map()` / `.tap()` / `.filter()` → `.get()` /
  `.getOrElse()` / `.getOrNull()`. Use it for construct-validate-unwrap in one
  expression.
- **Never `asOption(await …).tap(…).get()`** (`BanAsOptionAwait`): bind the
  awaited value and use plain statements, or compose a real `Future` pipeline.
- `Future` for async flows you chain; `Either.try(fn)` when you branch on
  success/failure.
- Error primitives, chosen by what you do with the outcome:

| You want to…                                        | Use                                              |
| --------------------------------------------------- | ------------------------------------------------ |
| branch on success/failure                           | `Either.try(fn)`                                 |
| run a side effect best-effort and ignore the result | `guard(fn)` (`utils/asyncUtils.ts`)              |
| run a fn, swallow, get value-or-default             | `getValue(fn, fallback)` (`utils/asyncUtils.ts`) |

Never call `Either.try` and discard the `Either`.

## 3. Options / Config / Defaults

Three layers per configurable component:

```ts
/** What the caller provides. All fields optional, each with JSDoc. */
export interface FooOptions {
  host?: string
  port?: number
}
/** What the implementation requires. */
export interface FooConfig extends Required<FooOptions> {}
/** Default resolution; may be async. */
export async function createFooDefaultOptions(): Promise<Partial<FooOptions>> {
  return { host: Foo.DefaultHost, port: Foo.DefaultPort }
}
```

Merge with
`defaults({ ...options }, await createFooDefaultOptions()) as FooConfig` (caller
wins, input never mutated), then assert invariants. Defaults live as constants
in the companion namespace, never as literals in the defaults function. Options
compose the richest existing domain types — never a flat bag of primitives
re-spelling what those types carry.

## 4. Factory model

- Async static `create()` + private constructor **only** when construction is
  genuinely async or the class is a singleton with a precondition. A plain
  value-holding class stays `new`-able.
- Companion `namespace` with the same name carries constants, sub-types and
  helpers (`Foo.DefaultPort`, `Foo.StartupTimeoutMs`, `Foo.Identity`).
- Singleton variant: explicit `setX()` precondition + lazy `get()` with
  `assert`.
- Mutating/configuring methods return `this` for fluent chaining.

## 5. Naming

- Verb stems: factory `create*` (never `make*`/`build*`); newly created `new*`
  (never `fresh*`); composition `append` (never `apply`); get-or-throw helpers
  `assert*` (never `require*` — Node global collision, lint-enforced).
- Every word spelled out; only `id` and unit suffixes (`Ms`, `Sec`) are exempt.
- Paths: directory refs end in `Path`, file refs in `File`, relative segments in
  `Subpath`.
- **Enums are identity-mapped string enums** (`create = "create"`). **String
  unions derive from enums, never hand-written** (`BanStringLiteralUnion`):
  `` `${Enum}` ``, `keyof typeof Enum`, or a union of `Enum.member` types. A
  single literal discriminator (`kind: "Foo.Input"`) is fine.
- Numeric separators for timeouts and large values: `15_000`.
- When a name is corrected, sweep every occurrence in the same change.

## 6. Files and directories

- Directories: always `kebab-case`.
- Files: **PascalCase** when the primary export is a
  class/interface/type/namespace (`ReviewStateStore.ts`); **camelCase topic
  files** for utility collections (`asyncUtils.ts`, `shellUtils.ts`) — never
  one-function files. `index.ts` is the barrel; `Constants.ts` is the sanctioned
  PascalCase root exception.
- One concept per file. Component kind picks the folder and suffix
  (`hooks/handlers/<Name>Handler.ts`, `cli/commands/<Name>Command.ts`).
- Never create a file before something consumes it.

## 7. Imports, exports, barrels

- Import order: Node built-ins → external packages → relative imports, blank
  line between.
- Relative imports **always carry `.js`**; never reference a directory
  (`"./state/index.js"`, not `"./state"`).
- Every directory with public exports has an `index.ts` of
  `export * from "./X.js"` lines only; parent barrels re-export
  `"./<subdir>/index.js"`.
- **No `src/` in any import specifier** (lint-enforced). Tests import through
  the package self-alias.
- Named exports only; no default exports. Never `export *` a third-party
  package.
- Lodash: import individual functions (`defaults`, `identity`, `last`) for
  focused utilities; don't use it for what `Array`/`Object` do natively.
  `identity` for no-op callbacks (`local/no-identity-arrow`).

## 8. Declarations and expressions

- Joined `const` declarations for bindings derived from one source.
- **Destructuring over member-coalesce** (`BanMemberCoalesceDeclarator`):
  `const { member: local = Default } = obj`, never
  `const local = obj.member ?? Default`.
- No inline IIFEs (`BanInlineIife`) — extract a named helper.
- No inline (anonymous) object types (`BanInlineTypeLiteral`) — every shape gets
  a named interface or type.
- No `Pick<T, K>` in parameter position (`BanPickParameter`): one field →
  `T["field"]`, several optional → `Partial<T>`, otherwise `T`.
- Modern paradigms: `forEach`/`map`/`filter`/`reduce`, spreads, `match()` — not
  index loops and branching chains.

## 9. `null` over `undefined` — under `strictNullChecks: false`

`null` is the "no value" sentinel; `undefined` is reserved for what the language
forces (`?` params/props, `Promise<void>`, third-party APIs — normalize at the
boundary). Because the checker is off:

- **Never write `?? null` to "normalize"** a value — pass it as-is.
- **Never append `| null` / `| undefined` to a return type or field** to satisfy
  the rule (`BanNullUnionReturn`); write the plain type; callers guard with
  `!= null`.
- Use an explicit `null` only where it carries **runtime** meaning — chiefly
  JSON persistence (`undefined` drops the key, `null` survives).
  `let pending: Foo | null = null` for assign-later locals remains the standing
  form.

## 10. Errors

- `Assert.ok()` (node:assert) liberally at the top of public methods and
  factories; fail fast.
- Re-wrap caught errors as `new NestedError(message, { cause, context })`
  (`src/errors/NestedError.ts`) — never restring `err.message` into a bare
  `Error` (`BanErrorMessageRestring`), never a bare `Error` inside a
  `catch`/`mapLeft`/`recover` handler (`BanBareErrorInHandler`).
- Never silently swallow an I/O or API error: log through the framework with the
  error's message — `debug` for expected control flow, `warn` for tolerated
  transients, `error` plus rethrow for the unexpected.
- `eqeqeq` always, except `== null` / `!= null`.

## 11. Logging

- Every file that logs makes its **own** logger:
  `const log = getLogger(__filename)` from `src/logging/`, backed by `tracer`
  with a file transport. The filename is the category.
- Never `export const log`; never name a logger `out`.
- **`console.*` is banned** (lint-enforced) — stdout carries hook/CLI JSON, and
  a stray `console.log` corrupts the protocol. The only writer of
  `process.stdout` is the routing appender in `src/logging/`.
- `source-map-support/register` first thing in the CLI entry.

## 12. Timers and handles

Every `setTimeout` armed inside a `Promise.race` is cleared when the race
settles; long-lived module timers are `.unref()`d. Spawned children in tests are
`.unref()`d and reaped in `afterAll`.

## 13. No inline literals

Meaningful strings and numbers live in the companion namespace or `Constants.ts`
(`GDocReview.ReplyPrefix`, `GDocReview.MenuHeader`). `as const` for literal
arrays. If a value is defined in an enum/constant, reference the identifier —
never the raw literal.

## 14. Config persistence

Resolved config and state are JSON-serializable and written through a validated
codec (zod schema-first: `z.object(...)`, `z.infer` for the type, one codec per
document). The persisted file is the single source of truth; expensive
resolution happens once.

## 15. CLI tools

- yargs with **framework-native dispatch**: one `create<Name>Command()` factory
  per command, enum members as command names, builder and handler collocated,
  `identity` for no-op builders, `.demandCommand(1).strict()`. Never a
  `match`/`switch` on top of yargs routing.
- Cross-cutting parsed values live in a module-level state object populated by
  middleware.
- Signal handlers registered once at module scope.
- CLI args are `string[]`, never shell-interpolated strings.

## 16. Testing

- Unit tests for every new or modified symbol — happy path plus at least one
  failure/edge case, same change. `tests/` mirrors `src/`; files are
  `<PrimaryExport>.test.ts`.
- No network, no real Google calls: recorded tool responses live in
  `tests/fixtures/`.
- Never bind a fixed port; never depend on process ancestry; fixtures and
  children never outlive the worker.

## 17. Mechanical style laws (lint-enforced, no exemption lists)

`BanSwitch`, `BanInlineIife`, `BanNullUnionReturn`, `BanInlineTypeLiteral`,
`BanPickParameter`, `BanStringLiteralUnion`, `BanAsOptionAwait`,
`BanMemberCoalesceDeclarator`, `BanBareErrorInHandler`,
`BanErrorMessageRestring`, `local/no-identity-arrow`, `no-console`, `id-match`
(no `require*`), `no-restricted-imports` (no `src/`), `no-restricted-properties`
(no `process.stdout` / `process.stderr` outside `src/logging/`), `eqeqeq`.
`error` means banned and the tree is clean of it — there is no ratchet and no
per-file downgrade.

## 18. Design discipline

- Never decide by file count or "simpler"; decide on semantic correctness and
  these rules.
- "No ceremony" means no _empty_ wrapping — a lambda around one call, dead
  indirection — it never justifies collapsing meaningful typed structure.
- Execute the entire plan: every enumerated item lands or its deferral is
  explicitly agreed.
- JSDoc on every public/exported symbol (functions, classes, public methods,
  interfaces and their fields, type aliases, enums, exported constants). Skip
  locals and private fields.
