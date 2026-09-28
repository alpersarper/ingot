/**
 * `run` against a port that is already held.
 *
 * Unlike `cli.test.ts` this suite starts real servers: the behaviour under test
 * is what the command prints, how it exits and what it leaves on disk when it
 * loses the port, and those are only observable with something on the port.
 * Nothing here opens a browser (`--no-open`), and every library is a temporary
 * directory named through the environment, never `~/.ingot`.
 */
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, startPanel } from '@ingot/server'
import { run } from '../src/cli'
import type { PanelHandle } from '@ingot/server'

let dir: string
let running: PanelHandle | undefined
let stdout: string
let stderr: string

async function invoke(argv: readonly string[]): Promise<number> {
  process.exitCode = undefined
  await run(['--no-open', ...argv])
  const code = Number(process.exitCode ?? 0)
  process.exitCode = undefined
  return code
}

async function startOwnPanel(token: string): Promise<PanelHandle> {
  const config = loadConfig({ INGOT_DATA_DIR: dir, INGOT_HOST: '127.0.0.1', INGOT_PAIRING_TOKEN: token })
  return startPanel({ ...config, port: 0 })
}

async function verifies(port: number, token: string): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/api/pairing/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return response.status
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ingot-cli-'))
  stdout = ''
  stderr = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
  vi.stubEnv('INGOT_DATA_DIR', dir)
  vi.stubEnv('INGOT_HOST', undefined)
  vi.stubEnv('INGOT_PAIRING_TOKEN', undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await running?.close()
  running = undefined
  await rm(dir, { recursive: true, force: true })
})

describe('a port held by an Ingot panel', () => {
  it('points a bare run at it, says the library may differ, and leaves its token alone', async () => {
    running = await startOwnPanel('OLD')
    vi.stubEnv('INGOT_PAIRING_TOKEN', 'NEW')

    expect(await invoke(['--port', String(running.port)])).toBe(0)
    expect(stdout).toContain(`An Ingot panel is already running on http://127.0.0.1:${running.port}`)
    expect(stdout).toContain('may be serving a different library')
    expect(stderr).toBe('')

    expect(await readFile(running.tokenFile, 'utf8')).toBe('OLD\n')
    expect(await verifies(running.port, 'OLD')).toBe(200)
    expect(await verifies(running.port, 'NEW')).toBe(401)
  })

  it('fails when --data-dir named a library it cannot confirm, and creates nothing', async () => {
    running = await startOwnPanel('OLD')
    const other = join(dir, 'other-library')

    expect(await invoke(['--port', String(running.port), '--data-dir', other])).toBe(1)
    expect(stderr).toContain('Stop that panel')
    expect(stderr).toContain(`--port ${running.port + 1}`)
    expect(stdout).toBe('')
    await expect(stat(other)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails when --host named an address, even the one the panel is on', async () => {
    running = await startOwnPanel('OLD')

    expect(await invoke(['--port', String(running.port), '--host', '127.0.0.1'])).toBe(1)
    expect(stderr).toContain(`http://127.0.0.1:${running.port}`)
    expect(stderr).toContain('Stop that panel')
  })
})

describe('a port held by something else', () => {
  it('fails with the way out', async () => {
    const stranger = createServer((socket) => socket.destroy())
    await new Promise<void>((ready) => stranger.listen(0, '127.0.0.1', ready))
    const address = stranger.address()
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
    try {
      expect(await invoke(['--port', String(address.port)])).toBe(1)
      expect(stderr).toContain(`something else is already listening on port ${address.port}`)
    } finally {
      await new Promise((done) => stranger.close(done))
    }
  })
})

describe('a pinned token that disagrees with the library', () => {
  // `INGOT_PORT=0` lets the OS choose, so the second run has no port to guess
  // and always gets as far as the token.
  beforeEach(() => {
    vi.stubEnv('INGOT_PORT', '0')
  })

  it('fails and leaves the running panel\'s token alone', async () => {
    running = await startOwnPanel('OLD')

    expect(await invoke(['--token', 'NEW'])).toBe(1)
    expect(stderr).toContain('Pairing token conflict')
    expect(stderr).toContain('INGOT_PAIRING_TOKEN_ROTATE=1')
    expect(stderr).toContain('--rotate-token')
    expect(stderr).not.toContain('OLD')
    expect(stdout).toBe('')

    expect(await readFile(running.tokenFile, 'utf8')).toBe('OLD\n')
    expect(await verifies(running.port, 'OLD')).toBe(200)
  })

  it('replaces it with --rotate-token, and says the paired clients must pair again', async () => {
    const first = await startOwnPanel('OLD')
    await first.close()

    process.exitCode = undefined
    running = await run(['--no-open', '--token', 'NEW', '--rotate-token'])
    expect(process.exitCode ?? 0).toBe(0)
    if (running === undefined) throw new Error('expected a running panel')

    expect(stdout).toContain('Pairing token ROTATED')
    expect(stdout).toContain('must pair again')
    expect(await readFile(running.tokenFile, 'utf8')).toBe('NEW\n')
    expect(await verifies(running.port, 'NEW')).toBe(200)
    expect(await verifies(running.port, 'OLD')).toBe(401)
  })

  it('says nothing about rotation when --rotate-token pins the token already stored', async () => {
    const first = await startOwnPanel('OLD')
    await first.close()

    running = await run(['--no-open', '--token', 'OLD', '--rotate-token'])
    if (running === undefined) throw new Error('expected a running panel')
    expect(stdout).not.toContain('ROTATED')
    expect(await verifies(running.port, 'OLD')).toBe(200)
  })
})
