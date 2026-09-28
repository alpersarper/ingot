/**
 * `npx ingot-workbench`: the panel, on this machine, with nothing installed.
 *
 * This is a launcher and nothing more. It resolves flags and environment into a
 * `ServerConfig`, hands it to the server's own `startPanel`, and prints the two
 * things a human needs -- an address and a pairing token. Every decision about
 * storage, routing, guards and the engine stays in `apps/server`, so the npx path
 * and `docker compose up` are the same server with the same behaviour and the
 * same data format; only the packaging differs.
 *
 * The defaults that are this file's own, and why, are in `resolve.ts`.
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { ENGINE_NAME } from '@ingot/engine'
import { loadConfig, PAIRING_TOKEN_ROTATED_NOTICE, startPanel } from '@ingot/server'
import type { PanelHandle } from '@ingot/server'
import { HELP, parseArgs } from './args'
import { packagedPanelDir, pairingUrl, panelEnv, panelUrl, portHeld } from './resolve'

/** This package's version, read from the manifest npm published beside it. */
async function version(): Promise<string> {
  const manifest = await readFile(new URL('../package.json', import.meta.url), 'utf8')
  return (JSON.parse(manifest) as { version: string }).version
}

/** The platform's "open this in whatever handles it" command. */
function openCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') return { command: 'open', args: [url] }
  // The empty string is `start`'s title argument; without it a URL containing
  // `&` is read as the window title and nothing opens.
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

/** Best effort, and silent when it fails: the address is printed either way. */
function openBrowser(url: string): void {
  const { command, args } = openCommand(url)
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    // Without this an absent `xdg-open` becomes an unhandled 'error' event and
    // takes the panel down with it.
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // Same reasoning: a browser that will not open is not a reason to stop.
  }
}

function isAddressInUse(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'EADDRINUSE'
}

/** Whether what already holds this port is an Ingot panel rather than a stranger. */
async function ingotAnswersOn(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return false
    const body = (await response.json()) as { engine?: { name?: unknown } }
    return body.engine?.name === ENGINE_NAME
  } catch {
    return false
  }
}

function isPairingTokenConflict(cause: unknown): cause is Error {
  return (
    cause instanceof Error && (cause as { code?: unknown }).code === 'INGOT_PAIRING_TOKEN_CONFLICT'
  )
}

function out(text: string): void {
  process.stdout.write(text)
}

/** Returns the running panel, or nothing when this run printed and stopped. */
export async function run(argv: readonly string[]): Promise<PanelHandle | undefined> {
  const parsed = parseArgs(argv)

  if (parsed.kind === 'help') {
    out(HELP)
    return undefined
  }
  if (parsed.kind === 'version') {
    out(`${await version()}\n`)
    return undefined
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`\n  ingot: ${parsed.message}\n\n${HELP}`)
    process.exitCode = 1
    return undefined
  }

  const config = loadConfig(
    panelEnv(parsed.options, process.env, {
      home: homedir(),
      panelDir: packagedPanelDir(import.meta.url),
    }),
  )

  let handle
  try {
    handle = await startPanel(config)
  } catch (cause) {
    if (isPairingTokenConflict(cause)) {
      process.stderr.write(`\n  ingot: ${cause.message}\n\n`)
      process.exitCode = 1
      return undefined
    }
    if (!isAddressInUse(cause)) throw cause
    const url = panelUrl(config.host, config.port)
    const outcome = portHeld(parsed.options, {
      url,
      port: config.port,
      dataDir: config.dataDir,
      ingot: await ingotAnswersOn(url),
    })
    process[outcome.stream].write(outcome.message)
    process.exitCode = outcome.exitCode
    return undefined
  }

  const url = panelUrl(handle.config.host, handle.port)
  out(
    `\n  Ingot ${await version()}\n\n` +
      `  Panel     ${url}\n` +
      `  Library   ${handle.config.dataDir}\n` +
      `  Token     ${handle.pairingToken}\n` +
      `            also in ${handle.tokenFile}, and needed by the capture extension\n\n`,
  )
  if (handle.pairingTokenRotated) out(`  ${PAIRING_TOKEN_ROTATED_NOTICE}\n\n`)

  if (parsed.options.open) {
    openBrowser(pairingUrl(handle.config.host, handle.port, handle.pairingToken))
    out('  Opening your browser -- it pairs itself. Ctrl-C stops the panel.\n\n')
  } else {
    out(`  Open ${url} and paste the token into the first-run screen. Ctrl-C stops the panel.\n\n`)
  }
  return handle
}
