/**
 * The buffer, end to end, against a transport that can be taken down.
 *
 * This is the promise the extension makes that is hardest to see by hand: pick
 * three components with the panel stopped, restart the browser, start the
 * panel, and get three captures in the order you took them. Every step of that
 * is here -- including the restart, which is modelled by building a second
 * queue over the same storage, because that is exactly what the service worker
 * does when MV3 evicts it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { CaptureRecord } from '@ingot/engine'
import { createQueue, MAX_PENDING, MAX_PENDING_BYTES, PENDING_KEY, QueueFullError } from '../src/shared/queue'
import type { KeyValueStore, Queue } from '../src/shared/queue'
import type { ScreenshotBlob } from '../src/shared/protocol'
import type { SendOutcome, Transport } from '../src/shared/transport'

/** `chrome.storage.local`, minus Chrome. Survives being handed to a new queue. */
function memoryStore(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get(keys) {
      const out: Record<string, unknown> = {}
      for (const key of keys) if (data.has(key)) out[key] = structuredClone(data.get(key))
      return out
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value))
    },
  }
}

/** A panel that can be switched off, and that remembers what it was sent. */
function fakePanel() {
  const received: string[] = []
  const shots: string[] = []
  let outcome: SendOutcome = { kind: 'sent' }

  const transport: Transport = {
    async send(record, screenshot) {
      if (outcome.kind !== 'sent') return outcome
      received.push(record.id)
      if (screenshot !== null) shots.push(record.id)
      return { kind: 'sent' }
    },
    async check() {
      return outcome.kind === 'sent' ? { ok: true } : { ok: false, message: 'down' }
    },
  }

  return {
    transport,
    received,
    shots,
    stop: (kind: 'unreachable' | 'refused' = 'unreachable') => {
      outcome = { kind, message: kind === 'refused' ? 'that pairing token is not valid' : 'Failed to fetch' }
    },
    start: () => {
      outcome = { kind: 'sent' }
    },
    /** Answer one specific capture with a permanent no. */
    rejectOnly: (id: string) => {
      const inner = transport.send
      transport.send = async (record, screenshot) =>
        record.id === id ? { kind: 'rejected', message: 'does not satisfy the capture schema' } : inner(record, screenshot)
    },
  }
}

function record(id: string): CaptureRecord {
  return {
    schemaVersion: 1,
    id,
    componentType: 'button',
    sourceUrl: 'https://example.com/pricing',
    capturedAt: '2026-02-11T09:14:22.000Z',
    screenshot: null,
    styles: { backgroundColor: 'rgb(99, 91, 255)' },
  }
}

const SHOT: ScreenshotBlob = {
  contentType: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  width: 120,
  height: 40,
}

describe('the capture buffer', () => {
  let store: ReturnType<typeof memoryStore>
  let panel: ReturnType<typeof fakePanel>
  let badge: number[]
  let queue: Queue

  /** A fresh queue over the same storage: what a service-worker restart is. */
  function restart(): Queue {
    return createQueue({
      store,
      transport: async () => panel.transport,
      onCount: (pending) => {
        badge.push(pending)
      },
      now: () => '2026-02-11T09:20:00.000Z',
    })
  }

  beforeEach(() => {
    store = memoryStore()
    panel = fakePanel()
    badge = []
    queue = restart()
  })

  it('sends a capture straight through when the panel is up', async () => {
    await queue.enqueue(record('a'), SHOT, '2026-02-11T09:14:22.000Z')
    const result = await queue.drain()

    expect(result).toEqual({ sent: 1, pending: 0, error: null })
    expect(panel.received).toEqual(['a'])
    expect(panel.shots).toEqual(['a'])
  })

  it('keeps every capture when the panel is down, and shows the count', async () => {
    panel.stop()
    for (const id of ['a', 'b', 'c']) await queue.enqueue(record(id), SHOT, '2026-02-11T09:14:22.000Z')

    const result = await queue.drain()

    expect(result.sent).toBe(0)
    expect(result.pending).toBe(3)
    expect(result.error).toBe('Failed to fetch')
    expect(panel.received).toEqual([])
    expect(badge.at(-1)).toBe(3)
    expect((await queue.status()).pending).toBe(3)
  })

  it('drains in the order the captures were taken, once the panel is back', async () => {
    panel.stop()
    for (const id of ['a', 'b', 'c']) await queue.enqueue(record(id), SHOT, '2026-02-11T09:14:22.000Z')
    await queue.drain()

    panel.start()
    const result = await queue.drain()

    expect(result).toEqual({ sent: 3, pending: 0, error: null })
    expect(panel.received).toEqual(['a', 'b', 'c'])
    expect(badge.at(-1)).toBe(0)
  })

  it('loses nothing across a restart', async () => {
    panel.stop()
    for (const id of ['a', 'b']) await queue.enqueue(record(id), SHOT, '2026-02-11T09:14:22.000Z')
    await queue.drain()

    // The worker is evicted, or the browser is closed and reopened. Storage is
    // the only thing that survives, so the new queue is built over just that.
    const reborn = restart()
    expect(await reborn.pendingCount()).toBe(2)

    panel.start()
    const result = await reborn.drain()

    expect(result).toEqual({ sent: 2, pending: 0, error: null })
    expect(panel.received).toEqual(['a', 'b'])
  })

  it('stops at the first capture it could not send, rather than skipping it', async () => {
    await queue.enqueue(record('a'), null, '2026-02-11T09:14:22.000Z')
    await queue.drain()
    expect(panel.received).toEqual(['a'])

    panel.stop()
    for (const id of ['b', 'c']) await queue.enqueue(record(id), null, '2026-02-11T09:14:22.000Z')
    await queue.drain()

    panel.start()
    await queue.drain()
    expect(panel.received).toEqual(['a', 'b', 'c'])
  })

  it('holds the queue, rather than discarding it, when the token is wrong', async () => {
    // A refused token is a setting to fix, not a reason to throw away work.
    panel.stop('refused')
    await queue.enqueue(record('a'), null, '2026-02-11T09:14:22.000Z')
    const result = await queue.drain()

    expect(result.pending).toBe(1)
    expect((await queue.status()).lastError).toBe('that pairing token is not valid')

    panel.start()
    expect((await queue.drain()).sent).toBe(1)
  })

  it('parks a capture the panel will never accept, so the rest still get through', async () => {
    panel.rejectOnly('b')
    for (const id of ['a', 'b', 'c']) await queue.enqueue(record(id), null, '2026-02-11T09:14:22.000Z')

    const result = await queue.drain()

    expect(panel.received).toEqual(['a', 'c'])
    expect(result.pending).toBe(0)
    const status = await queue.status()
    expect(status.rejected.map((item) => item.record.id)).toEqual(['b'])
    expect(status.rejected[0]?.reason).toContain('capture schema')
  })

  it('forgets parked captures when asked, and only then', async () => {
    panel.rejectOnly('b')
    await queue.enqueue(record('b'), null, '2026-02-11T09:14:22.000Z')
    await queue.drain()
    expect((await queue.status()).rejected).toHaveLength(1)

    await queue.clearRejected()
    expect((await queue.status()).rejected).toEqual([])
  })

  it('replaces rather than duplicates when one element is captured twice', async () => {
    // Ids are stable by design, so re-picking the same button before a drain
    // would otherwise queue the same capture twice for the panel to upsert.
    panel.stop()
    await queue.enqueue(record('a'), null, '2026-02-11T09:14:22.000Z')
    await queue.enqueue({ ...record('a'), componentType: 'card' }, null, '2026-02-11T09:15:00.000Z')
    expect(await queue.pendingCount()).toBe(1)

    panel.start()
    await queue.drain()
    expect(panel.received).toEqual(['a'])
    const stored = store.data.get(PENDING_KEY)
    expect(stored).toEqual([])
  })

  it('refuses to grow past the cap, and says what to do about it', async () => {
    panel.stop()
    for (let i = 0; i < MAX_PENDING; i += 1) {
      await queue.enqueue(record(`capture-${i}`), null, '2026-02-11T09:14:22.000Z')
    }
    await expect(queue.enqueue(record('one-too-many'), null, '2026-02-11T09:14:22.000Z')).rejects.toBeInstanceOf(
      QueueFullError,
    )
    expect(await queue.pendingCount()).toBe(MAX_PENDING)
  })

  it('refuses to grow past the byte budget, before the write that would throw', async () => {
    // A hundred captures is not a size: a card screenshot is orders of
    // magnitude larger than a button's. Without this, a handful of big ones
    // would reach the storage quota and the failure would be an exception
    // inside a drain, not an answer in front of the person who picked them.
    panel.stop()
    const big: ScreenshotBlob = { ...SHOT, dataUrl: `data:image/png;base64,${'A'.repeat(3_000_000)}` }
    await queue.enqueue(record('a'), big, '2026-02-11T09:14:22.000Z')
    await queue.enqueue(record('b'), big, '2026-02-11T09:14:22.000Z')
    await expect(queue.enqueue(record('c'), big, '2026-02-11T09:14:22.000Z')).rejects.toBeInstanceOf(QueueFullError)

    // The refused capture is not in the buffer, and the ones before it are.
    expect(await queue.pendingCount()).toBe(2)
    expect(JSON.stringify(store.data.get(PENDING_KEY)).length).toBeLessThan(MAX_PENDING_BYTES)
  })

  it('says how much is waiting when the byte budget is what stopped it', async () => {
    panel.stop()
    const big: ScreenshotBlob = { ...SHOT, dataUrl: `data:image/png;base64,${'A'.repeat(8_100_000)}` }
    await expect(queue.enqueue(record('a'), big, '2026-02-11T09:14:22.000Z')).rejects.toThrow(/MB of screenshots/)
  })

  it('runs one drain at a time, so a concurrent wake-up cannot resurrect a capture', async () => {
    for (const id of ['a', 'b']) await queue.enqueue(record(id), null, '2026-02-11T09:14:22.000Z')

    // The alarm, the toolbar and the options page can all wake the worker at
    // once; two drains reading the same queue would send everything twice.
    const [first, second] = await Promise.all([queue.drain(), queue.drain()])

    expect(panel.received).toEqual(['a', 'b'])
    expect(first).toEqual(second)
    expect(await queue.pendingCount()).toBe(0)
  })
})
