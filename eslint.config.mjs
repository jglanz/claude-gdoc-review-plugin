// =============================================================================
// Mechanical enforcement of the recurring violation classes from STYLE.md.
//
// Scope discipline:
//  - Formatting belongs to prettier (.prettierrc.js): eslint-config-prettier
//    is applied LAST so no rule here can fight it.
//  - The tsconfig compiles with `strictNullChecks: false` (etc/tsconfig/
//    tsconfig.base.json) — no rule below assumes strict-null semantics, and
//    `eqeqeq` allows `!= null` (the sanctioned both-nullish guard).
//  - Syntactic rules only (no type-checked linting).
//  - `error` means the class is BANNED and the tree is clean of it — for
//    EVERY file, with no debt list, no ratchet and no per-file exemption.
//    A grandfather list hides NEW violations in the files it exempts, so
//    banning a class means fixing every occurrence in the same change.
//
// Deliberately NOT enforced here (and why):
//  - `new Promise`: the legitimate timer/race shape is not syntactically
//    separable from the banned promisify-a-callback-API case. STYLE.md and
//    review govern.
//  - Naming standards (assert*/create*/new*/append), factory model, options
//    design: semantic — STYLE.md governs.
// =============================================================================
import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import prettier from "eslint-config-prettier"

// An identity arrow `x => x` IS lodash `identity` — import it instead. A custom
// rule because no-restricted-syntax (esquery) cannot assert that the body name
// equals the parameter name.
const localPlugin = {
  meta: { name: "local" },
  rules: {
    "no-identity-arrow": {
      meta: {
        type: "problem",
        docs: { description: "Use lodash `identity` instead of an `x => x` arrow." },
        messages: {
          useLodashIdentity: "Use `identity` from lodash instead of an `x => x` arrow."
        },
        schema: []
      },
      create(context) {
        return {
          ArrowFunctionExpression(node) {
            const [param] = node.params
            if (
              node.params.length === 1 &&
              param.type === "Identifier" &&
              node.body.type === "Identifier" &&
              node.body.name === param.name
            ) {
              context.report({ node, messageId: "useLodashIdentity" })
            }
          }
        }
      }
    }
  }
}

// STYLE.md "match() over switch always".
const BanSwitch = {
  selector: "SwitchStatement",
  message: "Use match() from ts-pattern (STYLE.md 'match() over switch always')."
}

// STYLE.md "Extracted Helper Functions": an immediately-invoked function
// expression hides a nameable operation inside an expression slot — extract a
// named local helper, or use asOption().tap().get().
const BanInlineIife = {
  selector:
    "CallExpression[callee.type='ArrowFunctionExpression'], CallExpression[callee.type='FunctionExpression']",
  message: "No inline IIFEs — extract a named local helper (STYLE.md 'Extracted Helper Functions')."
}

// strictNullChecks is OFF, so a `| null` union on a return type is never
// enforced by the compiler — it is dead ceremony. Write the plain type;
// callers guard with `!= null`.
const BanNullUnionReturn = {
  selector: ":function > TSTypeAnnotation.returnType TSUnionType > TSNullKeyword",
  message:
    "No `| null` return-type ceremony — strictNullChecks is OFF, the union is unenforced clutter; write the plain type (STYLE.md 'null over undefined')."
}

// No inline (anonymous) object types — every object shape gets a NAMED
// interface/type. Inline function types in parameter position stay allowed.
const BanInlineTypeLiteral = {
  selector: "TSTypeLiteral",
  message: "No inline object types — declare a named interface/type (STYLE.md 'Declarations')."
}

// A parameter demands the minimum REAL data — one field → the indexed-access
// type (`alive: Snapshot["alive"]`), several optional fields → Partial<T>, the
// real object → T. A Pick<T,K> parameter forces callers to assemble a synthetic
// one-off object that is neither the domain object nor a plain value. Return
// types and genuine data-model projections are out of scope (the selector
// matches parameter positions only).
const BanPickParameter = {
  selector:
    ":matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSDeclareFunction, TSEmptyBodyFunctionExpression, TSMethodSignature, TSFunctionType) > :matches(Identifier, ObjectPattern, ArrayPattern, RestElement, AssignmentPattern, TSParameterProperty) TSTypeReference[typeName.name='Pick']",
  message:
    'No Pick<T,K> parameter contracts — one field → indexed access (T["field"]), several optional fields → Partial<T>, otherwise T (STYLE.md \'Declarations\').'
}

// A hand-written union of string literals is a closed set without its enum.
// Declare the identity enum and use its members — or, when a union TYPE is
// genuinely needed, derive it from an existing enum (`${Enum}` template /
// keyof typeof Enum / a union of Enum.member types).
const BanStringLiteralUnion = {
  selector: "TSUnionType > TSLiteralType > Literal[raw=/^[\"']/]",
  message:
    "No hand-written string-literal unions — declare the identity enum, or derive the union from one (`${Enum}` / keyof typeof Enum) (STYLE.md 'Naming')."
}

// Wrapping an ALREADY-AWAITED value in asOption just to tap a side effect and
// get() it back is ceremony — bind the value and use plain statements (or a
// genuine Future pipeline when composing async stages).
const BanAsOptionAwait = {
  selector: "CallExpression[callee.name='asOption'] > AwaitExpression",
  message:
    "Never asOption(await …) — bind the awaited value and use plain statements (or a genuine Future pipeline) (STYLE.md 'Functional pipelines')."
}

// `const local = obj.member ?? Default` re-spells the member name at every pull
// — destructure with defaults/renames instead:
// `const { member: local = Default } = obj`. Computed members (`arr[0]`) and
// optional chains stay accessor-form.
const BanMemberCoalesceDeclarator = {
  selector:
    "VariableDeclarator > LogicalExpression.init[operator='??'] > MemberExpression.left[computed=false]",
  message:
    "Destructure with a default — `const { member: local = Default } = obj` — not `const local = obj.member ?? Default` (STYLE.md 'Destructuring over member-coalesce')."
}

// NEVER rewrite a caught error into a bare Error that restrings it — the root
// cause, its stack and its message are SWALLOWED. Wrap it:
// NestedError(message, { cause, context }). (a) the restring tell — a caught
// error's `.message`/`.stack` interpolated into a new Error.
const BanErrorMessageRestring = {
  selector:
    "NewExpression[callee.name=/^(Error|TypeError|RangeError|EvalError|SyntaxError|URIError)$/] :matches(CallExpression[callee.name='toMessage'], MemberExpression[property.name=/^(message|stack)$/][object.name=/^(err|error|e|ex|cause|reason)$/])",
  message:
    "Don't restring a caught error into a bare Error — use NestedError(message, { cause, context }) so the root cause + its stack survive (STYLE.md 'Errors')."
}
// (b) a bare (no-cause) native Error constructed inside an error handler that
// RECEIVES the error (Either.mapLeft/ifLeft, Promise.catch, Future.onFailure)
// — it discards the very error being handled. Throw a NestedError with
// { cause }. NOT Option's orElse/ifNone — those handle ABSENCE (a None is not
// an error), so a fresh Error there has no cause to preserve.
const BanBareErrorInHandler = {
  selector:
    "CallExpression[callee.property.name=/^(mapLeft|ifLeft|catch|recoverWith|onFailure)$/] NewExpression[callee.name=/^(Error|TypeError|RangeError|EvalError|SyntaxError|URIError)$/][arguments.length<2]",
  message:
    "A bare Error in an error handler (mapLeft/ifLeft/catch/recoverWith/onFailure) SWALLOWS the handled error — throw a NestedError with { cause } (STYLE.md 'Errors')."
}

// Every ban applies to EVERY file — there is no exemption list, no ratchet and
// no per-file downgrade. A class is banned only once the tree is clean of it.
const AllBans = [
  BanSwitch,
  BanInlineIife,
  BanNullUnionReturn,
  BanInlineTypeLiteral,
  BanPickParameter,
  BanStringLiteralUnion,
  BanAsOptionAwait,
  BanMemberCoalesceDeclarator,
  BanErrorMessageRestring,
  BanBareErrorInHandler
]

export default tseslint.config(
  {
    ignores: [
      "**/lib/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
      // TypeScript is the enforcement target: the style laws + tsconfig govern
      // .ts. Plain JS (config files, the bin launcher — whose console IS its
      // user interface) is prettier/tsc territory.
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      // Agent/session scratch state, not source.
      ".omc/**",
      ".remember/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { local: localPlugin },
    rules: {
      // stdout is the hook/CLI protocol channel and a stray console.log
      // corrupts it; diagnostics go through the file logger. Carve-out below.
      "no-console": "error",

      // An `x => x` arrow IS lodash `identity`.
      "local/no-identity-arrow": "error",

      "no-restricted-syntax": ["error", ...AllBans],

      // Get-or-throw helpers are assert*, NEVER require* (collides with the
      // Node global).
      "id-match": [
        "error",
        "^(?!require[A-Z]).*$",
        { properties: false, classFields: false, onlyDeclarations: true }
      ],

      // STYLE.md "No src/ in any import specifier".
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src/*", "**/src"],
              message:
                "No src/ in import specifiers — use the package alias or the barrel (STYLE.md 'Imports')."
            }
          ]
        }
      ],

      // Raw stream writes live ONLY in the logging appenders (override below).
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "stdout",
          message:
            "process.stdout belongs to the logging appenders only — use the logger (STYLE.md 'Logging')."
        },
        {
          object: "process",
          property: "stderr",
          message:
            "process.stderr belongs to the logging appenders only — use the logger (STYLE.md 'Logging')."
        }
      ],

      // STYLE.md prescribes `!= null` as the both-nullish guard — eqeqeq must
      // not fight it.
      eqeqeq: ["error", "always", { null: "ignore" }],

      // `any` OFF by design: the explicit `any` in this codebase is
      // strongly-typed usage — generic type arguments, boundary casts, rest
      // args (`...args: any[]`) and generic defaults — NOT lazy typing.
      // no-explicit-any is blunt: no option distinguishes a type-argument `any`
      // from a lazy `x: any`, so allowing those legitimate patterns globally
      // means the rule is off. The precise-types discipline stays enforced by
      // STYLE.md + review.
      "@typescript-eslint/no-explicit-any": "off",

      // Defaults that fight house idioms or the loose tsconfig.
      "@typescript-eslint/no-namespace": "off", // companion namespaces ARE the style
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-require-imports": "off", // CJS output target
      // Off deliberately: the house style USES empty object shapes as semantic
      // structure — `interface FooConfig extends Required<FooOptions> {}`
      // (three-layer options), empty NAMED marker interfaces, and `{}` generic
      // defaults. The rule fights the named-types-everywhere philosophy.
      "@typescript-eslint/no-empty-object-type": "off",
      // A catch clause that rethrows a bare Error SWALLOWS the original (its
      // message + stack). Preserve it as `{ cause }` — pair with NestedError
      // for the { cause, context } form.
      "preserve-caught-error": "error",
      "prefer-const": "error",
      "no-var": "error"
    }
  },
  {
    // The CLI launcher: console IS its user interface.
    files: ["bin/**"],
    rules: { "no-console": "off" }
  },
  {
    // The sanctioned raw-stream home: the logging appenders and the per-file
    // logger factory are the only writers of process.stdout/stderr.
    files: ["src/logging/**"],
    rules: { "no-restricted-properties": "off" }
  },
  {
    // Tests PROVE the stream discipline: asserting that a module never touches
    // stdout/stderr requires naming the streams to spy on them. This carve-out
    // is for that assertion only — every other law still applies to tests, and
    // no test may WRITE to a stream.
    files: ["tests/**"],
    rules: { "no-restricted-properties": "off" }
  },
  prettier
)
