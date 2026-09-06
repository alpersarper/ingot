/**
 * Determinism through the server.
 *
 * The engine's guarantee is that the same capture set produces byte-identical
 * `tokens.json` and `design.md`. The server can break that without touching the
 * engine -- by reordering captures, by re-serialising a record on the way in or
 * out, by inventing set metadata. This suite is the guard: every committed
 * example must come back out of the API byte for byte.
 *
 * If this fails, the fix is in the server, never in `examples/`.
 */
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, body } from './harness'
import type { Harness } from './harness'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const setIds = (await readdir(`${ROOT}fixtures`, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.close()
})

/** Import a fixture set through the API and generate its kit. Returns the kit id. */
async function importAndGenerate(setId: string): Promise<string> {
  const set = JSON.parse(await readFile(`${ROOT}fixtures/${setId}/set.json`, 'utf8')) as unknown
  const imported = (await (await harness.call('/api/captures/import', body(set))).json()) as {
    group: { id: string }
  }
  const generated = (await (await harness.call('/api/kits', body({ groupId: imported.group.id }))).json()) as {
    kit: { id: string }
  }
  return generated.kit.id
}

describe.each(setIds)('%s through the server', (setId) => {
  it('downloads the same design.md the skeleton writes', async () => {
    const kitId = await importAndGenerate(setId)
    const downloaded = await (await harness.call(`/api/kits/${kitId}/design.md`)).text()
    expect(downloaded).toBe(await readFile(`${ROOT}examples/${setId}/design.md`, 'utf8'))
  })

  it('downloads the same tokens.json the skeleton writes', async () => {
    const kitId = await importAndGenerate(setId)
    const downloaded = await (await harness.call(`/api/kits/${kitId}/tokens.json`)).text()
    expect(downloaded).toBe(await readFile(`${ROOT}examples/${setId}/tokens.json`, 'utf8'))
  })
})

describe('what the server could break and does not', () => {
  it('hands the engine captures in the imported order, not the database\'s', async () => {
    const set = JSON.parse(await readFile(`${ROOT}fixtures/ghost-warm/set.json`, 'utf8')) as {
      captures: Array<{ id: string }>
    }
    const kitId = await importAndGenerate('ghost-warm')
    const kit = (await harness.json<{ kit: { captureIds: string[] } }>(`/api/kits/${kitId}`)).kit
    expect(kit.captureIds).toEqual(set.captures.map((capture) => capture.id))
  })

  it('produces the same bytes when the same set is imported twice and regenerated', async () => {
    const first = await importAndGenerate('stripe-light')
    const second = await importAndGenerate('stripe-light')
    expect(await (await harness.call(`/api/kits/${second}/design.md`)).text()).toBe(
      await (await harness.call(`/api/kits/${first}/design.md`)).text(),
    )
  })

  it('produces the same bytes across two independent servers', async () => {
    const other = await createHarness()
    try {
      const here = await importAndGenerate('linear-dark')

      const set = JSON.parse(await readFile(`${ROOT}fixtures/linear-dark/set.json`, 'utf8')) as unknown
      const imported = (await (await other.call('/api/captures/import', body(set))).json()) as { group: { id: string } }
      const generated = (await (await other.call('/api/kits', body({ groupId: imported.group.id }))).json()) as {
        kit: { id: string }
      }

      expect(await (await other.call(`/api/kits/${generated.kit.id}/tokens.json`)).text()).toBe(
        await (await harness.call(`/api/kits/${here}/tokens.json`)).text(),
      )
    } finally {
      await other.close()
    }
  })
})
