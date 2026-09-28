#!/usr/bin/env node
/**
 * The `ingot` executable. Deliberately three lines of logic.
 *
 * Everything real is in `dist/ingot.js`, the bundle `build.mjs` writes: the CLI,
 * the panel server and the engine, with `better-sqlite3` left external because it
 * is a native module. This file exists so that `bin` in package.json points at
 * something that is in the repository and reviewable, rather than at a build
 * artefact -- and so that a missing build says so in a sentence.
 */
const bundle = new URL('../dist/ingot.js', import.meta.url)

let run
try {
  ;({ run } = await import(bundle.href))
} catch (cause) {
  if (cause?.code !== 'ERR_MODULE_NOT_FOUND') throw cause
  process.stderr.write(
    '\n  ingot: this checkout has not been built.\n' +
      '  Run `pnpm build:cli` from the repository root, or install the published package.\n\n',
  )
  process.exit(1)
}

await run(process.argv.slice(2))
