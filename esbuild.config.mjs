import { chmodSync } from "node:fs"

import esbuild from "esbuild"

// The bundle entry: the CLI, whose `hook` subcommand is what hooks.json runs.
const EntryFile = "src/cli/index.ts"

const OutFile = "dist/gdoc-review.cjs"

// Bundled ESM dependencies (yargs-parser) read `import.meta.url` to build a
// `createRequire`. CJS output has no import.meta, and esbuild would emit an
// `undefined` that throws at load time, so the banner defines the equivalent
// and `define` rewrites every reference to it.
const ImportMetaUrlIdentifier = "__gdocReviewImportMetaUrl"

const Banner = [
  "#!/usr/bin/env node",
  `const ${ImportMetaUrlIdentifier} = require("node:url").pathToFileURL(__filename).href;`
].join("\n")

// `dist/gdoc-review.cjs` is the ONLY runtime artifact: hooks.json and the bin
// launcher both invoke it with a bare `node`, so every dependency is inlined
// (source-map-support included) and nothing is marked external. The shebang
// banner + exec bit let it also be run directly.
await esbuild.build({
  entryPoints: [EntryFile],
  outfile: OutFile,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: "inline",
  minify: false,
  external: [],
  define: { "import.meta.url": ImportMetaUrlIdentifier },
  banner: { js: Banner },
  logLevel: "info"
})

chmodSync(OutFile, 0o755)
