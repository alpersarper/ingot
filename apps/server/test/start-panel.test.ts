/**
 * `startPanel` against a library another panel may already be serving.
 *
 * A second start that loses the port, or pins a token the library does not
 * store, must leave that panel's world exactly as it was: the stored token, the
 * token file, and the token the running panel enforces. Replacing the token is
 * possible only when rotation is asked for, and then it is announced.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { loadConfig, startPanel } from '../src/index'
import type { PanelHandle, ServerConfig } from '../src/index'

let dir: string
let running: PanelHandle | undefined

function config(overrides: Partial<ServerConfig> = {}, dataDir = dir): ServerConfig {
  return { ...loadConfig({ INGOT_DATA_DIR: dataDir, INGOT_HOST: '127.0.0.1' }), port: 0, ...overrides }
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
  dir = await mkdtemp(join(tmpdir(), 'ingot-start-'))
})

afterEach(async () => {
  await running?.close()
  running = undefined
  await rm(dir, { recursive: true, force: true })
})

describe('startPanel', () => {
  it('leaves the running panel\'s token alone when the port is already held', async () => {
    running = await startPanel(config({ pairingToken: 'OLD' }))

    await expect(startPanel(config({ port: running.port, pairingToken: 'NEW' }))).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })

    expect(await readFile(running.tokenFile, 'utf8')).toBe('OLD\n')
    expect(await verifies(running.port, 'OLD')).toBe(200)
    expect(await verifies(running.port, 'NEW')).toBe(401)

    // The stored token is the one a restart without a pinned token comes back with.
    await running.close()
    running = await startPanel(config())
    expect(running.pairingToken).toBe('OLD')
  })

  it('creates nothing in a fresh data directory when the port is already held', async () => {
    running = await startPanel(config())
    const fresh = join(dir, 'elsewhere')

    await expect(startPanel(config({ port: running.port }, fresh))).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
    await expect(stat(fresh)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('establishes a pinned token on a fresh data directory', async () => {
    running = await startPanel(config({ pairingToken: 'PINNED' }))
    expect(running.pairingToken).toBe('PINNED')
    expect(await readFile(running.tokenFile, 'utf8')).toBe('PINNED\n')
    expect(await verifies(running.port, 'PINNED')).toBe(200)
  })

  it('starts normally when the pinned token is the one already stored', async () => {
    running = await startPanel(config({ pairingToken: 'OLD' }))
    await running.close()

    running = await startPanel(config({ pairingToken: 'OLD' }))
    expect(running.pairingToken).toBe('OLD')
    expect(await verifies(running.port, 'OLD')).toBe(200)
  })

  it('refuses a different pinned token for a library another panel is serving, and writes nothing', async () => {
    running = await startPanel(config({ pairingToken: 'OLD' }))
    const before = await readFile(running.tokenFile)

    await expect(startPanel(config({ pairingToken: 'NEW' }))).rejects.toMatchObject({
      code: 'INGOT_PAIRING_TOKEN_CONFLICT',
    })

    expect(await readFile(running.tokenFile)).toEqual(before)
    expect(await verifies(running.port, 'OLD')).toBe(200)

    await running.close()
    running = await startPanel(config())
    expect(running.pairingToken).toBe('OLD')
  })

  it('does not put either token in the conflict message', async () => {
    running = await startPanel(config({ pairingToken: 'OLD-SECRET' }))
    const failure = await startPanel(config({ pairingToken: 'NEW-SECRET' })).catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('--data-dir')
    expect((failure as Error).message).not.toContain('OLD-SECRET')
    expect((failure as Error).message).not.toContain('NEW-SECRET')
  })

  it('replaces a different stored token when rotation is asked for, and says so', async () => {
    running = await startPanel(config({ pairingToken: 'OLD' }))
    expect(running.pairingTokenRotated).toBe(false)
    await running.close()

    running = await startPanel(config({ pairingToken: 'NEW', rotatePairingToken: true }))
    expect(running.pairingTokenRotated).toBe(true)
    expect(await readFile(running.tokenFile, 'utf8')).toBe('NEW\n')
    expect(await verifies(running.port, 'NEW')).toBe(200)
    expect(await verifies(running.port, 'OLD')).toBe(401)

    await running.close()
    running = await startPanel(config())
    expect(running.pairingToken).toBe('NEW')
  })

  it('treats rotation to the token already stored, or onto a fresh library, as no rotation', async () => {
    running = await startPanel(config({ pairingToken: 'OLD', rotatePairingToken: true }))
    expect(running.pairingTokenRotated).toBe(false)
    await running.close()

    running = await startPanel(config({ pairingToken: 'OLD', rotatePairingToken: true }))
    expect(running.pairingTokenRotated).toBe(false)
  })
})

/**
 * The container's entry point, run as the container runs it: a process whose
 * output is a log. What it prints, and how it exits, is the contract here.
 */
describe('the server entry point', () => {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  const root = fileURLToPath(new URL('../../..', import.meta.url))

  function launch(env: Record<string, string>): ChildProcess {
    return spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: root,
      env: { ...process.env, INGOT_DATA_DIR: dir, INGOT_HOST: '127.0.0.1', INGOT_PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  function collect(child: ChildProcess): { stdout: () => string; stderr: () => string } {
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => (stdout += String(chunk)))
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)))
    return { stdout: () => stdout, stderr: () => stderr }
  }

  function exited(child: ChildProcess): Promise<number | null> {
    return new Promise((done) => child.on('exit', (code) => done(code)))
  }

  async function seed(token: string): Promise<void> {
    const first = await startPanel(config({ pairingToken: token }))
    await first.close()
  }

  it('exits 1 on a conflicting pinned token with both ways out, no stack trace, and nothing written', async () => {
    await seed('OLD')
    const before = await readFile(join(dir, 'pairing-token.txt'))

    const child = launch({ INGOT_PAIRING_TOKEN: 'NEW' })
    const output = collect(child)
    expect(await exited(child)).toBe(1)

    expect(output.stderr()).toContain('Pairing token conflict')
    expect(output.stderr()).toContain('pairing-token.txt')
    expect(output.stderr()).toContain('INGOT_PAIRING_TOKEN_ROTATE=1')
    expect(output.stderr()).not.toMatch(/^\s+at /m)
    expect(output.stdout()).toBe('')
    expect(await readFile(join(dir, 'pairing-token.txt'))).toEqual(before)
  }, 20_000)

  it('states a rotation before its usual banner', async () => {
    await seed('OLD')

    const child = launch({ INGOT_PAIRING_TOKEN: 'NEW', INGOT_PAIRING_TOKEN_ROTATE: '1' })
    const output = collect(child)
    try {
      await vi.waitFor(() => expect(output.stdout()).toContain('Data directory:'), { timeout: 15_000 })
    } finally {
      child.kill('SIGTERM')
      await exited(child)
    }

    const stdout = output.stdout()
    expect(stdout).toContain('Pairing token ROTATED')
    expect(stdout).toContain('must pair again')
    expect(stdout.indexOf('ROTATED')).toBeLessThan(stdout.indexOf('Pairing token: NEW'))
    expect(await readFile(join(dir, 'pairing-token.txt'), 'utf8')).toBe('NEW\n')
  }, 20_000)
})
