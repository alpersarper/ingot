#!/usr/bin/env node
/**
 * The panel server entry point.
 *
 * Everything that touches the outside world happens here or in the modules it
 * wires together: opening the database, creating the data directory, minting
 * the pairing token on first run, and listening. `createApp` itself takes its
 * whole world as an argument, which is what lets the tests build one without a
 * port or a file.
 *
 * Two things start this server: `node server/server.js` in the container, and
 * the `ingot` CLI (`apps/cli`) on a machine with no Docker. They share
 * {@link startPanel} -- the listening, the volume, the token file and the
 * shutdown handlers are the server's job in both -- and differ only in what they
 * print, because a container log and a terminal a human is watching want
 * different words.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { createApp } from './app'
import { createAssistant } from './assistant/service'
import { createRateLimiter } from './assistant/rate-limit'
import { loadConfig } from './config'
import { createScreenshotStore } from './screenshots'
import { PAIRING_TOKEN_ROTATED_NOTICE, PairingTokenConflictError, resolvePairingToken } from './pairing'
import { createSqliteStore } from './storage/sqlite'
import { systemClock, uuidIdFactory } from './storage/ids'
import type { AppContext } from './context'
import type { ServerConfig } from './config'

// The CLI (`apps/cli`) starts this server in-process, so the entry point is the
// seam it depends on: configuration and startup come from here rather than from
// a deep path into the server's internals.
export { loadConfig } from './config'
export type { ServerConfig } from './config'
export { PAIRING_TOKEN_ROTATED_NOTICE, PairingTokenConflictError } from './pairing'

/** Open the volume and the database, and establish the pairing token. */
export async function createContext(
  config: ServerConfig,
): Promise<AppContext & { readonly pairingTokenRotated: boolean }> {
  await mkdir(config.dataDir, { recursive: true })
  await mkdir(config.screenshotDir, { recursive: true })

  const store = createSqliteStore({
    file: config.databaseFile,
    idFactory: uuidIdFactory,
    clock: systemClock,
  })
  // The database holds the pairing token and the LLM keys, so it is readable by
  // its owner and nobody else. Best-effort: some volume drivers refuse chmod.
  await chmod(config.databaseFile, 0o600).catch(() => undefined)

  let pairingToken: string
  let pairingTokenRotated: boolean
  try {
    ;({ token: pairingToken, rotated: pairingTokenRotated } = await resolvePairingToken(
      store,
      config.pairingToken,
      config.rotatePairingToken,
    ))
  } catch (cause) {
    await store.close().catch(() => undefined)
    throw cause
  }

  return {
    config,
    store,
    screenshots: createScreenshotStore(config.screenshotDir),
    pairingToken,
    pairingTokenRotated,
    // Built whether or not a key is configured: "no key" is an answer the
    // assistant gives, and the panel needs to be told it in order to show the
    // setup path. Nothing here reaches a provider until a route asks it to.
    // The resolved pairing token rides along so the assistant's redaction
    // covers it even when it was minted here rather than pinned in the
    // environment.
    assistant: createAssistant({ store, config, pairingToken }),
    assistantLimiter: createRateLimiter({
      max: config.assistantRateLimit,
      windowMs: config.assistantRateWindowMs,
    }),
  }
}

/** A listening panel, and everything a caller needs in order to describe it. */
export interface PanelHandle {
  /** The port actually bound, which is the configured one or the OS's choice. */
  readonly port: number
  readonly config: ServerConfig
  /** The token every API call must carry, minted here on a fresh data directory. */
  readonly pairingToken: string
  /** Where the token was written, so a caller can point a human at it. */
  readonly tokenFile: string
  /** True when this start replaced a different stored token, which the caller must say. */
  readonly pairingTokenRotated: boolean
  /** Stop listening and close the database, as SIGINT/SIGTERM would, without exiting. */
  close(): Promise<void>
}

/**
 * Write the token where the user can copy it from.
 *
 * The first-run screen asks for a token the user has to get from somewhere;
 * this is that somewhere. The file is 0600 for the same reason the database is.
 */
async function writePairingToken(config: ServerConfig, token: string): Promise<string> {
  const file = join(config.dataDir, 'pairing-token.txt')
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  await chmod(file, 0o600).catch(() => undefined)
  return file
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((done) => server.close(() => done()))
}

/**
 * Bind the port, then open the volume, and stay up until a signal says otherwise.
 *
 * The port comes first, and that order is the point: the data directory may
 * belong to a panel that is already running, and a second start that lost the
 * race for the port must leave its database, its settings row and its token
 * file exactly as it found them. Otherwise a pinned token would be written over
 * the running panel's before the port refused, and the file would disagree with
 * the token that panel still enforces. Until the context exists -- a few
 * milliseconds -- a request is answered 503 rather than queued.
 *
 * Deliberately silent: the caller owns what gets printed. What it does *not*
 * leave to the caller is the shutdown path -- closing the listener and the
 * database on SIGINT/SIGTERM is a property of running this server, not of any
 * one way of launching it.
 */
export async function startPanel(config: ServerConfig = loadConfig()): Promise<PanelHandle> {
  let app: ReturnType<typeof createApp> | undefined
  const { server, port } = await new Promise<{ server: ServerType; port: number }>((ready, fail) => {
    // A port already in use is the one startup failure a caller can act on, so it
    // arrives as a rejection rather than as an unhandled event. Only *before*
    // listening, though: once the panel is up this listener is removed, because a
    // later socket error is not a reason to close the database underneath a
    // running server.
    const server = serve(
      {
        fetch: (request, env) =>
          app === undefined ? new Response('starting', { status: 503 }) : app.fetch(request, env),
        hostname: config.host,
        port: config.port,
      },
      (info) => {
        server.off('error', fail)
        ready({ server, port: info.port })
      },
    )
    server.on('error', fail)
  })

  let context: Awaited<ReturnType<typeof createContext>>
  let tokenFile: string
  try {
    context = await createContext(config)
  } catch (cause) {
    await closeServer(server)
    throw cause
  }
  try {
    tokenFile = await writePairingToken(config, context.pairingToken)
    app = createApp(context)
  } catch (cause) {
    // The database is closed on the way out: the caller reports and exits, and a
    // held file lock would outlive the message.
    await closeServer(server)
    await context.store.close().catch(() => undefined)
    throw cause
  }

  const close = async (): Promise<void> => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    await closeServer(server)
    await context.store.close()
  }
  const shutdown = (signal: string): void => {
    process.stdout.write(`\n  ${signal}: shutting down\n`)
    void close().then(() => process.exit(0))
  }
  const onSigint = (): void => shutdown('SIGINT')
  const onSigterm = (): void => shutdown('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  return {
    port,
    config,
    pairingToken: context.pairingToken,
    tokenFile,
    pairingTokenRotated: context.pairingTokenRotated,
    close,
  }
}

async function main(): Promise<void> {
  let handle: PanelHandle
  try {
    handle = await startPanel()
  } catch (cause) {
    if (!(cause instanceof PairingTokenConflictError)) throw cause
    process.stderr.write(`\n  ${cause.message}\n\n`)
    process.exitCode = 1
    return
  }
  if (handle.pairingTokenRotated) process.stdout.write(`\n  ${PAIRING_TOKEN_ROTATED_NOTICE}\n`)
  process.stdout.write(
    `\n  Pairing token: ${handle.pairingToken}\n` +
      `  Also written to ${handle.tokenFile}\n` +
      '  Paste it into the panel\'s first-run screen. Every API call must carry it.\n\n',
  )
  process.stdout.write(`  Ingot panel on http://localhost:${handle.port}\n`)
  if (handle.config.panelDir === undefined) {
    process.stdout.write('  Serving the API only; run the panel with `pnpm --filter @ingot/panel dev`.\n')
  }
  process.stdout.write(`  Data directory: ${handle.config.dataDir}\n\n`)
}

/** True when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href
}

// The tests import `createContext` and build an app in memory; only a real
// invocation should open a port.
if (isEntryPoint()) await main()
