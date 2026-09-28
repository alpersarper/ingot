/**
 * Build the publishable `ingot` package.
 *
 * Two outputs, both inside `dist/`, both consumed by `bin/ingot.mjs`:
 *
 *   `dist/ingot.js`   the CLI, the panel server and the engine in one ESM
 *                     bundle, with `better-sqlite3` external because a native
 *                     module cannot be bundled. Same flags as the server's own
 *                     `build` script, for the same reason -- a container and a
 *                     tarball should not be running differently compiled code.
 *   `dist/panel/`     the built panel, copied verbatim. The server serves it, so
 *                     npx needs no second port and no build step on the user's
 *                     machine.
 *
 * The panel is *not* built here: `pnpm --filter @ingot/panel build` owns that,
 * and this script refuses to package a stale or missing one rather than shipping
 * a tarball whose panel is whatever was last left on disk.
 */
import { cp, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const panelSource = join(here, '..', 'panel', 'dist')
const dist = join(here, 'dist')

const built = await stat(join(panelSource, 'index.html')).catch(() => null)
if (built === null || !built.isFile()) {
  process.stderr.write(
    `\n  The panel has not been built: no index.html in ${panelSource}\n` +
      '  Run `pnpm --filter @ingot/panel build` first, or `pnpm build:cli` which does both.\n\n',
  )
  process.exit(1)
}

await rm(dist, { recursive: true, force: true })

await build({
  entryPoints: [join(here, 'src', 'cli.ts')],
  outfile: join(dist, 'ingot.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  logLevel: 'warning',
})

await cp(panelSource, join(dist, 'panel'), { recursive: true })

const { version } = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'))
process.stdout.write(`  ingot ${version}: dist/ingot.js + dist/panel\n`)
