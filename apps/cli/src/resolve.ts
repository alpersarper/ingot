/**
 * What the launcher decides, separated from the launching.
 *
 * Three defaults are the CLI's own, and each is a difference between a container
 * and a laptop:
 *
 *   - **The panel is served from the tarball.** `dist/panel` is built into the
 *     published package, so there is nothing to build and no second port.
 *   - **It binds `127.0.0.1`, not `0.0.0.0`.** The container has to accept
 *     connections from outside itself; a local run does not, and a workbench
 *     full of someone's captures should not appear on the coffee-shop wifi
 *     because they typed one command.
 *   - **The library lives in `~/.ingot`.** `npx` runs in whatever directory the
 *     user happened to be in, so a relative default would scatter one library
 *     across many folders and lose it.
 *
 * Kept free of the server and the engine so the test for it is a test of the
 * precedence rule and nothing else.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RunOptions } from './args'

/** This machine only. See the header: the container's `0.0.0.0` is not this. */
export const LOOPBACK = '127.0.0.1'

/**
 * Flags and environment resolved into the `INGOT_*` variables the server reads.
 *
 * Going through the environment rather than building a `ServerConfig` by hand is
 * deliberate: `apps/server/src/config.ts` stays the single place that decides
 * what a configuration value means, so every variable documented for Docker
 * keeps working under npx, and a flag is only ever a more convenient spelling of
 * one. A flag beats the environment; the environment beats these defaults.
 */
export function panelEnv(
  options: RunOptions,
  env: NodeJS.ProcessEnv,
  defaults: { home: string; panelDir: string },
): NodeJS.ProcessEnv {
  const overlay: NodeJS.ProcessEnv = { ...env }
  // Left unset when no flag asked for one, so the server's own 4310 applies
  // rather than being restated here and then drifting from it.
  if (options.port !== undefined) overlay['INGOT_PORT'] = String(options.port)
  if (options.token !== undefined) overlay['INGOT_PAIRING_TOKEN'] = options.token
  overlay['INGOT_HOST'] = options.host ?? env['INGOT_HOST'] ?? LOOPBACK
  overlay['INGOT_DATA_DIR'] = options.dataDir ?? env['INGOT_DATA_DIR'] ?? join(defaults.home, '.ingot')
  overlay['INGOT_PANEL_DIR'] = env['INGOT_PANEL_DIR'] ?? defaults.panelDir
  return overlay
}

/** The built panel inside this package: `dist/panel`, beside the bundle. */
export function packagedPanelDir(moduleUrl: string): string {
  return join(dirname(fileURLToPath(moduleUrl)), 'panel')
}

/**
 * Hand the token over in the URL *fragment*.
 *
 * A fragment is never sent to a server, never lands in an access log and never
 * travels in a `Referer`, which a query string does all three of. The panel
 * verifies it against `/api/pairing/verify`, stores it and strips it from the
 * address bar -- see `apps/panel/src/lib/api.ts`. The guard is unchanged: the
 * token is still required on every call, and a page on another origin can no
 * more read this fragment than it could read the panel's storage.
 */
export function pairingUrl(port: number, token: string): string {
  return `http://localhost:${port}/#token=${encodeURIComponent(token)}`
}
