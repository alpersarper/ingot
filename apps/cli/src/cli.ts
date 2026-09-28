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
import { loadConfig, startPanel } from '@ingot/server'
import { HELP, parseArgs } from './args'
import { packagedPanelDir, pairingUrl, panelEnv } from './resolve'

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
async function ingotAnswersOn(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return false
    const body = (await response.json()) as { engine?: { name?: unknown } }
    return body.engine?.name === ENGINE_NAME
  } catch {
    return false
  }
}

function out(text: string): void {
  process.stdout.write(text)
}

export async function run(argv: readonly string[]): Promise<void> {
  const parsed = parseArgs(argv)

  if (parsed.kind === 'help') return out(HELP)
  if (parsed.kind === 'version') return out(`${await version()}\n`)
  if (parsed.kind === 'error') {
    process.stderr.write(`\n  ingot: ${parsed.message}\n\n${HELP}`)
    process.exitCode = 1
    return
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
    if (!isAddressInUse(cause)) throw cause
    // A panel already on the port is the user's own workbench, and having one
    // there is what they asked for: say where it is and exit 0. A *stranger* on
    // the port is a real failure, so that one exits non-zero with the way out.
    if (await ingotAnswersOn(config.port)) {
      out(`\n  An Ingot panel is already running on http://localhost:${config.port}\n\n`)
      return
    }
    process.stderr.write(
      `\n  ingot: something else is already listening on port ${config.port}.\n` +
        `  Pick another with \`--port ${config.port + 1}\`.\n\n`,
    )
    process.exitCode = 1
    return
  }

  const url = `http://localhost:${handle.port}`
  out(
    `\n  Ingot ${await version()}\n\n` +
      `  Panel     ${url}\n` +
      `  Library   ${handle.config.dataDir}\n` +
      `  Token     ${handle.pairingToken}\n` +
      `            also in ${handle.tokenFile}, and needed by the capture extension\n\n`,
  )

  if (parsed.options.open) {
    openBrowser(pairingUrl(handle.port, handle.pairingToken))
    out('  Opening your browser -- it pairs itself. Ctrl-C stops the panel.\n\n')
  } else {
    out(`  Open ${url} and paste the token into the first-run screen. Ctrl-C stops the panel.\n\n`)
  }
}
