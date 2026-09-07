/**
 * An app in memory: no port, no file, no clock.
 *
 * The API tests call `app.fetch(request)` directly, which is the whole reason
 * `createApp` takes its world as an argument. Screenshots still need a real
 * directory, because the volume is a real thing and pretending otherwise would
 * test a filesystem that does not exist.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app'
import { loadConfig } from '../src/config'
import { createScreenshotStore } from '../src/screenshots'
import { countingIdFactory, steppingClock } from '../src/storage/ids'
import { createSqliteStore } from '../src/storage/sqlite'
import type { AppContext } from '../src/context'
import type { Store } from '../src/storage/store'

export const TEST_TOKEN = 'test-pairing-token'

export interface Harness {
  app: ReturnType<typeof createApp>
  context: AppContext
  store: Store
  /** Fetch an API path with the pairing token already attached. */
  call(path: string, init?: RequestInit): Promise<Response>
  /** Fetch without the token, for the tests that must be rejected. */
  raw(path: string, init?: RequestInit): Promise<Response>
  json<T = unknown>(path: string, init?: RequestInit): Promise<T>
  close(): Promise<void>
}

const ORIGIN = 'http://localhost:4310'

export async function createHarness(env: NodeJS.ProcessEnv = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ingot-api-'))
  const config = loadConfig({ INGOT_DATA_DIR: dataDir, ...env })
  const store = createSqliteStore({ file: ':memory:', idFactory: countingIdFactory(), clock: steppingClock() })
  const context: AppContext = {
    config,
    store,
    screenshots: createScreenshotStore(config.screenshotDir),
    pairingToken: TEST_TOKEN,
  }
  const app = createApp(context)

  const raw = async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.fetch(new Request(`${ORIGIN}${path}`, init))

  const call = (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('x-ingot-token', TEST_TOKEN)
    if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
    return raw(path, { ...init, headers })
  }

  return {
    app,
    context,
    store,
    call,
    raw,
    async json<T>(path: string, init?: RequestInit): Promise<T> {
      return (await call(path, init)).json() as Promise<T>
    },
    async close() {
      await store.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

/** A JSON POST body, so the tests read as what they are testing. */
export function body(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) }
}
