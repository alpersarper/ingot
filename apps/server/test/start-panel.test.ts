/**
 * `startPanel` against a port another panel already holds.
 *
 * The data directory may belong to the panel that won the port, so a second
 * start that loses it must leave that panel's world exactly as it was: the
 * stored token, the token file, and the token the running panel enforces.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})
