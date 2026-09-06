#!/usr/bin/env node
/**
 * The panel server entry point.
 *
 * Everything that touches the outside world happens here or in the modules it
 * wires together: opening the database, creating the data directory, minting
 * the pairing token on first run, and listening. `createApp` itself takes its
 * whole world as an argument, which is what lets the tests build one without a
 * port or a file.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadConfig } from './config'
import { createScreenshotStore } from './screenshots'
import { resolvePairingToken } from './pairing'
import { createSqliteStore } from './storage/sqlite'
import { systemClock, uuidIdFactory } from './storage/ids'
import type { AppContext } from './context'
import type { ServerConfig } from './config'

/** Open the volume and the database, and establish the pairing token. */
export async function createContext(config: ServerConfig): Promise<AppContext> {
  await mkdir(config.dataDir, { recursive: true })
  await mkdir(config.screenshotDir, { recursive: true })

  const store = createSqliteStore({
    file: config.databaseFile,
    idFactory: uuidIdFactory,
    clock: systemClock,
  })
  // The database holds the pairing token and the LLM key, so it is readable by
  // its owner and nobody else. Best-effort: some volume drivers refuse chmod.
  await chmod(config.databaseFile, 0o600).catch(() => undefined)

  const pairingToken = await resolvePairingToken(store, config.pairingToken)

  return { config, store, screenshots: createScreenshotStore(config.screenshotDir), pairingToken }
}

/**
 * Write the token where the user can copy it from, and say so on stdout.
 *
 * The first-run screen asks for a token the user has to get from somewhere;
 * this is that somewhere. The file is 0600 for the same reason the database is.
 */
async function announcePairing(config: ServerConfig, token: string): Promise<void> {
  const file = join(config.dataDir, 'pairing-token.txt')
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  await chmod(file, 0o600).catch(() => undefined)
  process.stdout.write(
    `\n  Pairing token: ${token}\n` +
      `  Also written to ${file}\n` +
      '  Paste it into the panel\'s first-run screen. Every API call must carry it.\n\n',
  )
}

async function main(): Promise<void> {
  const config = loadConfig()
  const context = await createContext(config)
  await announcePairing(config, context.pairingToken)

  const app = createApp(context)
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    process.stdout.write(`  Ingot panel on http://localhost:${info.port}\n`)
    if (config.panelDir === undefined) {
      process.stdout.write('  Serving the API only; run the panel with `pnpm --filter @ingot/panel dev`.\n')
    }
    process.stdout.write(`  Data directory: ${config.dataDir}\n\n`)
  })

  const shutdown = (signal: string): void => {
    process.stdout.write(`\n  ${signal}: shutting down\n`)
    server.close(() => {
      void context.store.close().then(() => process.exit(0))
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

/** True when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href
}

// The tests import `createContext` and build an app in memory; only a real
// invocation should open a port.
if (isEntryPoint()) await main()
